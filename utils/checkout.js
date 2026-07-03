// backend/utils/checkout.js
import Order from '../models/Order.js';
import DeliveryZone from '../models/DeliveryZone.js';
import Inventory from '../models/Inventory.js';
import { priceOrder, PricingError } from './pricing.js';
import { deductStockForOrder } from './stockEngine.js';

export class CheckoutError extends Error {}

const PAYMENT_TAGS = {
  CASH: '🟢 CASH',
  TRANSFER: '🔵 TRANSFER',
  POS: '🟣 POS',
  'WEBSITE PAYMENT': '🌐 WEBSITE PAYMENT',
};

/**
 * Builds a priced, stock-checked meal-combo order and persists it.
 * Shared by POS (store) and the website combo builder.
 *
 * cart = {
 *   mealPackages: [{ meals: ['jollof'], protein: 'regularChicken', extraPortions: [] }],
 *   extras: [{ item: 'plantain', qty: 1 }],
 * }
 *
 * deliveryMethod: 'delivery' | 'pickup'
 * deliveryZoneId: required when deliveryMethod === 'delivery' — the fee is
 *   ALWAYS resolved server-side from the DeliveryZone document, exactly like
 *   the existing POST /api/orders route does. A client-sent fee is never trusted.
 */
export async function createOrderFromCheckout({
  cart,
  source,               // 'store' | 'website'
  paymentMethod,        // 'CASH' | 'TRANSFER' | 'POS' | 'WEBSITE PAYMENT'
  staffName = '',
  customerName = '',
  customerEmail = '',
  phone = '',
  address = '',
  deliveryMethod = null,     // if omitted: 'pickup' for store, 'delivery' for website
  deliveryZoneId = null,
  notes = '',
  markPaidImmediately = false,
}) {
  if (source === 'store' && !['CASH', 'TRANSFER', 'POS'].includes(paymentMethod)) {
    throw new CheckoutError('A payment method (Cash, Transfer or POS) is required to complete a store sale.');
  }
  if (source === 'website') paymentMethod = 'WEBSITE PAYMENT';

  const resolvedDeliveryMethod = deliveryMethod || (source === 'store' ? 'pickup' : 'delivery');

  if (resolvedDeliveryMethod === 'delivery' && !address?.trim()) {
    throw new CheckoutError('Delivery address is required for delivery orders.');
  }

  // Resolve delivery fee SERVER-SIDE — never trust a fee sent from the browser.
  let deliveryFee = 0;
  let deliveryFeeSet = true;
  if (resolvedDeliveryMethod === 'delivery') {
    if (!deliveryZoneId) {
      // No recognized zone selected — matches existing behaviour: order can
      // still be placed, but waits for admin to set the fee manually before
      // it can be paid/verified.
      deliveryFeeSet = false;
    } else {
      const zone = await DeliveryZone.findOne({ _id: deliveryZoneId, active: true });
      if (!zone) throw new CheckoutError('Selected delivery zone is not available.');
      deliveryFee = zone.fee;
    }
  }

  const inv = await Inventory.getSingleton();
  const extrasCatalog = {};
  for (const [key, entry] of inv.extras.entries()) {
    extrasCatalog[key] = { label: entry.label, price: entry.price, usesPlastic: entry.usesPlastic };
  }

  let priced;
  try {
    priced = priceOrder({ ...cart, deliveryFee: 0 }, extrasCatalog); // delivery kept separate from item pricing
  } catch (err) {
    if (err instanceof PricingError) throw new CheckoutError(err.message);
    throw err;
  }

  const items = [
    ...priced.mealPackages.map((mp) => ({
      name: `${mp.meals.map((m) => (m === 'friedRice' ? 'Fried Rice' : m === 'jollof' ? 'Jollof' : 'Spaghetti')).join(' + ')}${mp.protein !== 'none' ? ` + ${mp.protein}` : ''}`,
      price: mp.lineTotal,
      quantity: 1,
      meta: mp,
    })),
    ...priced.extras.map((e) => ({ name: e.label, price: e.unitPrice, quantity: e.qty, meta: e })),
  ];

  const itemsSubtotal = priced.mealsTotal + priced.extrasTotal;
  const totalAmount = itemsSubtotal + (deliveryFeeSet ? deliveryFee : 0);

  const isStoreSale = source === 'store';

  const order = new Order({
    customerEmail: customerEmail || 'store-sale@solohans.local',
    customerName,
    phone,
    address: resolvedDeliveryMethod === 'delivery' ? address : '',
    notes,
    items,
    items_subtotal: itemsSubtotal,
    totalAmount,
    delivery_method: resolvedDeliveryMethod,
    delivery_fee: resolvedDeliveryMethod === 'pickup' ? 0 : (deliveryFeeSet ? deliveryFee : null),
    delivery_fee_set: resolvedDeliveryMethod === 'pickup' ? true : deliveryFeeSet,
    source,
    paymentMethod,
    staffName,
    mealPackages: priced.mealPackages,
    storeExtras: priced.extras,
    lunchBoxesUsed: priced.lunchBoxesUsed,
    mealsTotal: priced.mealsTotal,
    extrasTotal: priced.extrasTotal,
    order_type: isStoreSale ? 'store' : 'card',
    // Store sales are handed over and paid for on the spot — treat as
    // already complete, matching the "Completed" terminal pickup stage.
    status: isStoreSale ? 'Completed' : 'Pending',
    payment_status: isStoreSale || markPaidImmediately ? 'paid' : 'unpaid',
    // These orders are deducted from the shared Inventory system (rice
    // scoops / spaghetti plastics / lunch boxes) immediately below — NOT
    // via the old MenuItem-based deductStockForOrder() that runs on first
    // admin approval. Marking this true prevents that legacy path from
    // ever double-processing (or erroring on) a combo order's items.
    stockDeducted: true,
  });

  // Deduct shared inventory the moment the sale is committed.
  await deductStockForOrder(priced, { orderId: order._id, performedBy: staffName || paymentMethod });

  await order.save();

  return { order, priced, paymentTag: PAYMENT_TAGS[paymentMethod] };
}

export { PAYMENT_TAGS };