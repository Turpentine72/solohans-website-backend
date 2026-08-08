import MenuItem from '../models/MenuItem.js';
import DailyStock from '../models/DailyStock.js';

// ⚠️ LEGACY fallback only — for new orders, Daily Dish Stock is now
// deducted immediately at order placement (see utils/dishStockEngine.js,
// wired into routes/orders.js POST '/' and utils/checkout.js). Those
// orders are created with stockDeducted: true, so this function never
// touches them. This still exists purely as a safety net for any
// already-existing 'Pending' order from before this change that hasn't
// been approved yet — once it drains, this path is effectively dead code.
// Only ever touches dishes explicitly opted into tracking
// (trackDailyStock: true); everything else is left alone. Never throws —
// a stock hiccup must never block an order from being approved.
export async function deductStockForOrder(order) {
  try {
    for (const item of order.items) {
      if (!item.menu_item_id) continue; // free/manual items without a real menu item reference
      const menuItem = await MenuItem.findById(item.menu_item_id);
      if (!menuItem || !menuItem.trackDailyStock) continue;

      menuItem.sold = (menuItem.sold || 0) + item.quantity;
      menuItem.remaining = Math.max(0, (menuItem.remaining || 0) - item.quantity);
      await menuItem.save();
    }

    // Keep today's DailyStock snapshot in sync with the live MenuItem numbers
    const todayStock = await getOrCreateTodayStock();
    for (const entry of todayStock.items) {
      const menuItem = await MenuItem.findById(entry.menuItem);
      if (menuItem) {
        entry.sold = menuItem.sold;
        entry.remaining = menuItem.remaining;
      }
    }
    await todayStock.save();
  } catch (err) {
    console.error('Stock deduction error (non-fatal):', err.message);
  }
}

// Returns today's DailyStock doc, creating one from current MenuItem state
// if it doesn't exist yet (e.g. nobody has explicitly "opened" today yet).
// Only includes dishes explicitly opted into Daily Dish Stock tracking
// (trackDailyStock: true) — ordinary menu items (drinks, sides, anything
// not meant to have a daily portion cap) never appear here.
export async function getOrCreateTodayStock() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  let stock = await DailyStock.findOne({ date: { $gte: startOfDay, $lt: endOfDay } });
  if (!stock) {
    const menuItems = await MenuItem.find({ trackDailyStock: true });
    stock = await DailyStock.create({
      date: new Date(),
      items: menuItems.map(m => ({
        menuItem: m._id,
        name: m.name,
        openingStock: m.openingStock || 0,
        sold: m.sold || 0,
        remaining: m.remaining || 0,
      })),
    });
  } else {
    // ✅ A dish newly marked trackDailyStock=true mid-day (or added today)
    // should still show up on the Daily Dish Stock page without needing a
    // full day-close/reopen — merge in any tracked items missing from the
    // existing snapshot. Never removes an entry a admin already set.
    const existingIds = new Set(stock.items.map(i => String(i.menuItem)));
    const trackedItems = await MenuItem.find({ trackDailyStock: true });
    let changed = false;
    for (const m of trackedItems) {
      if (!existingIds.has(String(m._id))) {
        stock.items.push({
          menuItem: m._id,
          name: m.name,
          openingStock: m.openingStock || 0,
          sold: m.sold || 0,
          remaining: m.remaining || 0,
        });
        changed = true;
      }
    }
    if (changed) await stock.save();
  }
  return stock;
}