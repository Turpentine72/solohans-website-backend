// backend/utils/dishStockEngine.js
//
// DAILY DISH STOCK — tracks the number of FINISHED DISHES/PORTIONS
// available for sale today (e.g. "Regular Chicken", "Big Chicken",
// "Big Turkey" — each its own sellable MenuItem with its own quantity).
//
// Completely separate from:
//   - Meal Inventory (rice/spaghetti/boxes)   -> utils/stockEngine.js
//   - Ingredient Inventory (raw ingredients)  -> utils/ingredientEngine.js
//
// Only MenuItems with `trackDailyStock: true` are gated by this engine —
// every other menu item is untouched and behaves exactly as before.
import MenuItem from '../models/MenuItem.js';
import DailyStock from '../models/DailyStock.js';

export class DishStockError extends Error {}

/**
 * Given cart line items already resolved to MenuItem documents
 * (item = { menuItem, quantity }), validates that every dish opted into
 * Daily Dish Stock tracking has enough remaining portions — WITHOUT
 * mutating anything. Throws DishStockError naming the exact dish that's
 * short, so the customer/cashier gets a clear, specific reason.
 */
export async function assertDishStockAvailable(resolvedItems) {
  const neededByItem = {}; // menuItemId -> { name, needed }
  for (const { menuItem, quantity } of resolvedItems) {
    if (!menuItem?.trackDailyStock) continue; // not a tracked dish — no cap
    const id = String(menuItem._id);
    if (!neededByItem[id]) neededByItem[id] = { name: menuItem.name, needed: 0 };
    neededByItem[id].needed += Number(quantity) || 0;
  }

  const ids = Object.keys(neededByItem);
  if (ids.length === 0) return neededByItem; // nothing daily-stock-tracked in this order

  // Re-fetch fresh from the DB — never trust the already-loaded document's
  // `remaining`, since it may be stale by the time checkout actually runs.
  const freshItems = await MenuItem.find({ _id: { $in: ids } });
  const byId = Object.fromEntries(freshItems.map((m) => [String(m._id), m]));

  for (const id of ids) {
    const { name, needed } = neededByItem[id];
    const dish = byId[id];
    const remaining = dish ? Math.max(0, dish.remaining || 0) : 0;
    if (remaining <= 0) {
      throw new DishStockError(`${name} is out of stock for today.`);
    }
    if (needed > remaining) {
      throw new DishStockError(`Only ${remaining} × ${name} left in stock (you requested ${needed}).`);
    }
  }

  return neededByItem;
}

// Keeps today's DailyStock snapshot (used by the admin Daily Dish Stock
// page and Day Reconciliation) in sync with the live MenuItem numbers.
async function syncTodaySnapshot(menuItemIds) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const stock = await DailyStock.findOne({ date: { $gte: startOfDay, $lt: endOfDay } });
  if (!stock) return;

  const ids = new Set(menuItemIds.map(String));
  let changed = false;
  for (const entry of stock.items) {
    if (!ids.has(String(entry.menuItem))) continue;
    const menuItem = await MenuItem.findById(entry.menuItem);
    if (menuItem) {
      entry.sold = menuItem.sold;
      entry.remaining = menuItem.remaining;
      changed = true;
    }
  }
  if (changed) await stock.save();
}

/**
 * Validates AND atomically deducts Daily Dish Stock. Call this the moment
 * an order is actually placed/confirmed (order creation) — NEVER when an
 * item is merely added to the cart. Race-safe: each dish's remaining stock
 * is decremented with a DB-level guard (`remaining >= needed`) so two
 * concurrent orders can never oversell the same dish or push it negative.
 * Throws DishStockError (and deducts nothing) if anything is short.
 */
export async function deductDishStockForOrder(resolvedItems, { orderId, performedBy = '' } = {}) {
  const neededByItem = await assertDishStockAvailable(resolvedItems);
  const ids = Object.keys(neededByItem);
  if (ids.length === 0) return neededByItem;

  for (const id of ids) {
    const { needed, name } = neededByItem[id];
    // Atomic, race-safe decrement — only succeeds if enough stock is still
    // remaining at the moment of the write, never allowing negative stock.
    const updated = await MenuItem.findOneAndUpdate(
      { _id: id, remaining: { $gte: needed } },
      { $inc: { sold: needed, remaining: -needed } },
      { new: true }
    );
    if (!updated) {
      // Someone else's order used up the stock between validation and this
      // write — fail loudly rather than silently overselling.
      throw new DishStockError(`${name} just went out of stock. Please remove it and try again.`);
    }
  }

  await syncTodaySnapshot(ids);

  return neededByItem;
}