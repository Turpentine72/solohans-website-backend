import express from 'express';
import MenuItem from '../models/MenuItem.js';
import { protect, requireRole } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';
import { getOrCreateTodayStock } from '../utils/stockDeduction.js';

const router = express.Router();

// View today's stock — admin, storekeeper, and cashier can all see it
// (cashier needs visibility into sales/remaining stock to do their job).
router.get('/today', protect, requireRole('admin', 'storekeeper', 'cashier'), async (req, res) => {
  try {
    const stock = await getOrCreateTodayStock();
    res.json(stock);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Set opening stock for the day — admin and storekeeper only.
router.post('/opening', protect, requireRole('admin', 'storekeeper'), async (req, res) => {
  try {
    const { items } = req.body; // [{ menuItemId, openingStock }]
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: 'items array is required' });
    }

    for (const entry of items) {
      const qty = Number(entry.openingStock) || 0;
      await MenuItem.findByIdAndUpdate(entry.menuItemId, {
        openingStock: qty,
        sold: 0,
        remaining: qty,
      });
    }

    // Rebuild today's snapshot from the values just set
    const menuItems = await MenuItem.find();
    const DailyStock = (await import('../models/DailyStock.js')).default;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    await DailyStock.findOneAndUpdate(
      { date: { $gte: startOfDay, $lt: endOfDay } },
      {
        date: new Date(),
        items: menuItems.map(m => ({
          menuItem: m._id,
          name: m.name,
          openingStock: m.openingStock || 0,
          sold: 0,
          remaining: m.remaining || 0,
        })),
        isClosed: false,
        setBy: req.user.id,
      },
      { upsert: true, new: true }
    );

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Opening Stock Set',
      details: `Set opening stock for ${items.length} item(s)`,
    });

    res.json({ message: 'Opening stock set for today' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
