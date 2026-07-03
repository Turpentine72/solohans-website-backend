// backend/utils/stockEngine.js
import Inventory from '../models/Inventory.js';
import StockMovement from '../models/StockMovement.js';

export class StockError extends Error {}

function remaining(stock) {
  return (stock?.totalAdded || 0) - (stock?.sold || 0);
}

/**
 * Validates that a priced order (output of priceOrder()) can be fulfilled
 * with current inventory, WITHOUT mutating anything. Throws StockError if not.
 */
export async function assertStockAvailable(pricedOrder) {
  const inv = await Inventory.getSingleton();

  const scoopNeeded = { jollof: 0, friedRice: 0 };
  let plasticsNeeded = 0;
  let lunchBoxesNeeded = 0;
  const extraNeeded = {}; // item -> qty
  let extraPlasticsNeeded = 0;

  pricedOrder.mealPackages.forEach((mp) => {
    Object.entries(mp.scoopDeductions).forEach(([k, v]) => { scoopNeeded[k] = (scoopNeeded[k] || 0) + v; });
    plasticsNeeded += mp.spaghettiPlastics;
    lunchBoxesNeeded += mp.lunchBoxUsed;
  });

  pricedOrder.extras.forEach((e) => {
    extraNeeded[e.item] = (extraNeeded[e.item] || 0) + e.qty;
    if (e.usesPlastic) extraPlasticsNeeded += e.qty;
  });

  const problems = [];
  if (scoopNeeded.jollof > remaining(inv.jollof)) problems.push(`Not enough Jollof rice (need ${scoopNeeded.jollof}, have ${remaining(inv.jollof)})`);
  if (scoopNeeded.friedRice > remaining(inv.friedRice)) problems.push(`Not enough Fried Rice (need ${scoopNeeded.friedRice}, have ${remaining(inv.friedRice)})`);
  if (plasticsNeeded > remaining(inv.spaghettiPlastics)) problems.push(`Not enough Spaghetti plastics (need ${plasticsNeeded}, have ${remaining(inv.spaghettiPlastics)})`);
  if (lunchBoxesNeeded > remaining(inv.lunchBoxes)) problems.push(`Not enough lunch boxes (need ${lunchBoxesNeeded}, have ${remaining(inv.lunchBoxes)})`);
  if (extraPlasticsNeeded > remaining(inv.extraPlastics)) problems.push(`Not enough packaging plastics for extras (need ${extraPlasticsNeeded}, have ${remaining(inv.extraPlastics)})`);

  for (const [item, qty] of Object.entries(extraNeeded)) {
    const entry = inv.extras.get(item);
    if (!entry) { problems.push(`Unknown extra item: ${item}`); continue; }
    if (qty > remaining(entry)) problems.push(`Not enough ${entry.label} (need ${qty}, have ${remaining(entry)})`);
  }

  if (problems.length) throw new StockError(problems.join('; '));

  return { inv, scoopNeeded, plasticsNeeded, lunchBoxesNeeded, extraNeeded, extraPlasticsNeeded };
}

/**
 * Validates AND deducts stock for a priced order. Call this at the moment
 * a sale is completed (POS "Complete Sale" or website order creation).
 */
export async function deductStockForOrder(pricedOrder, { orderId, performedBy } = {}) {
  const { inv, scoopNeeded, plasticsNeeded, lunchBoxesNeeded, extraNeeded, extraPlasticsNeeded } = await assertStockAvailable(pricedOrder);

  if (scoopNeeded.jollof) inv.jollof.sold += scoopNeeded.jollof;
  if (scoopNeeded.friedRice) inv.friedRice.sold += scoopNeeded.friedRice;
  if (plasticsNeeded) inv.spaghettiPlastics.sold += plasticsNeeded;
  if (lunchBoxesNeeded) inv.lunchBoxes.sold += lunchBoxesNeeded;
  if (extraPlasticsNeeded) inv.extraPlastics.sold += extraPlasticsNeeded;

  let extraPortionsCount = 0;
  pricedOrder.mealPackages.forEach((mp) => { extraPortionsCount += mp.extraPortions.length; });
  if (extraPortionsCount) {
    inv.extraPortionsSold += extraPortionsCount;
    inv.extraPortionsRevenue += extraPortionsCount * 1500;
  }

  for (const [item, qty] of Object.entries(extraNeeded)) {
    const entry = inv.extras.get(item);
    entry.sold += qty;
    inv.extras.set(item, entry);
  }

  await inv.save();

  const movements = [];
  if (scoopNeeded.jollof) movements.push({ type: 'sale', item: 'jollof', quantity: -scoopNeeded.jollof, orderId, performedBy });
  if (scoopNeeded.friedRice) movements.push({ type: 'sale', item: 'friedRice', quantity: -scoopNeeded.friedRice, orderId, performedBy });
  if (plasticsNeeded) movements.push({ type: 'sale', item: 'spaghettiPlastics', quantity: -plasticsNeeded, orderId, performedBy });
  if (lunchBoxesNeeded) movements.push({ type: 'sale', item: 'lunchBoxes', quantity: -lunchBoxesNeeded, orderId, performedBy });
  if (extraPlasticsNeeded) movements.push({ type: 'sale', item: 'extraPlastics', quantity: -extraPlasticsNeeded, orderId, performedBy });
  for (const [item, qty] of Object.entries(extraNeeded)) {
    movements.push({ type: 'sale', item: `extras:${item}`, quantity: -qty, orderId, performedBy });
  }
  if (movements.length) await StockMovement.insertMany(movements);

  return inv;
}

/**
 * Restocks (admin "Add Stock") for any tracked item.
 * item one of: jollof, friedRice, spaghettiPlastics, lunchBoxes, extraPlastics, extras:<key>
 */
export async function restock(item, quantity, { reason = '', performedBy = '' } = {}) {
  const qty = Number(quantity);
  if (!qty || qty <= 0) throw new StockError('Quantity to add must be a positive number.');

  const inv = await Inventory.getSingleton();

  if (item.startsWith('extras:')) {
    const key = item.split(':')[1];
    const entry = inv.extras.get(key);
    if (!entry) throw new StockError(`Unknown extra item: ${key}`);
    entry.totalAdded += qty;
    inv.extras.set(key, entry);
  } else if (['jollof', 'friedRice', 'spaghettiPlastics', 'lunchBoxes', 'extraPlastics'].includes(item)) {
    inv[item].totalAdded += qty;
  } else {
    throw new StockError(`Unknown inventory item: ${item}`);
  }

  await inv.save();
  await StockMovement.create({ type: 'restock', item, quantity: qty, reason, performedBy });
  return inv;
}

export function inventorySnapshot(inv) {
  const extras = {};
  for (const [key, entry] of inv.extras.entries()) {
    extras[key] = {
      label: entry.label,
      price: entry.price,
      usesPlastic: entry.usesPlastic,
      totalAdded: entry.totalAdded,
      sold: entry.sold,
      remaining: remaining(entry),
    };
  }
  return {
    jollof: { ...inv.jollof.toObject(), remaining: remaining(inv.jollof) },
    friedRice: { ...inv.friedRice.toObject(), remaining: remaining(inv.friedRice) },
    spaghettiPlastics: { ...inv.spaghettiPlastics.toObject(), remaining: remaining(inv.spaghettiPlastics) },
    lunchBoxes: { ...inv.lunchBoxes.toObject(), remaining: remaining(inv.lunchBoxes) },
    extraPlastics: { ...inv.extraPlastics.toObject(), remaining: remaining(inv.extraPlastics) },
    extras,
    extraPortionsSold: inv.extraPortionsSold,
    extraPortionsRevenue: inv.extraPortionsRevenue,
    lowStockThreshold: inv.lowStockThreshold,
  };
}