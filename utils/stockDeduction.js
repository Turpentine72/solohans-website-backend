import MenuItem from '../models/MenuItem.js';
import DailyStock from '../models/DailyStock.js';

// Deducts sold quantities from each menu item's remaining stock and updates
// today's DailyStock snapshot to match. Never throws — a stock hiccup must
// never block an order from being approved.
export async function deductStockForOrder(order) {
  try {
    for (const item of order.items) {
      if (!item.menu_item_id) continue; // free/manual items without a real menu item reference
      const menuItem = await MenuItem.findById(item.menu_item_id);
      if (!menuItem) continue;

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
export async function getOrCreateTodayStock() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  let stock = await DailyStock.findOne({ date: { $gte: startOfDay, $lt: endOfDay } });
  if (!stock) {
    const menuItems = await MenuItem.find();
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
  }
  return stock;
}
