import express from 'express';
import MenuItem from '../models/MenuItem.js';
import DailyStock from '../models/DailyStock.js';
import Reconciliation from '../models/Reconciliation.js';
import { protect, requirePermission } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';
import { getOrCreateTodayStock } from '../utils/stockDeduction.js';

const router = express.Router();

// admin + closing_staff can perform end-of-day reconciliation
router.use(protect, requirePermission('reconciliation', 'view'));

// ─── GET expected stock for today (what the system thinks remains) ───────
router.get('/expected', async (req, res) => {
  try {
    const stock = await getOrCreateTodayStock();
    res.json(stock);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Close the day: compare actual counts vs expected, lock, reset ────────
router.post('/close-day', requirePermission('reconciliation', 'create'), async (req, res) => {
  try {
    const { actualCounts } = req.body; // [{ menuItemId, actual }]
    if (!Array.isArray(actualCounts)) {
      return res.status(400).json({ message: 'actualCounts array is required' });
    }

    const todayStock = await getOrCreateTodayStock();
    if (todayStock.isClosed) {
      return res.status(400).json({ message: 'Today has already been closed' });
    }

    const items = [];
    let hasMismatch = false;

    for (const stockEntry of todayStock.items) {
      const submitted = actualCounts.find(
        a => String(a.menuItemId) === String(stockEntry.menuItem)
      );
      const expected = stockEntry.remaining;
      const actual = submitted ? Number(submitted.actual) || 0 : 0;
      const difference = actual - expected;
      if (difference !== 0) hasMismatch = true;

      items.push({
        menuItem: stockEntry.menuItem,
        name: stockEntry.name,
        expectedStock: expected,
        actualStock: actual,
        difference,
      });
    }

    const reconciliation = await Reconciliation.create({
      date: new Date(),
      items,
      status: hasMismatch ? 'Mismatch' : 'Verified',
      closedBy: req.user.id,
    });

    // Lock today's stock
    todayStock.isClosed = true;
    await todayStock.save();

    // ✅ New day starts fresh — reset every menu item's stock counters
    await MenuItem.updateMany({}, { openingStock: 0, sold: 0, remaining: 0 });

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Day Closed',
      details: `Closed day with status "${reconciliation.status}" — ${items.length} item(s) reconciled`,
    });

    res.json(reconciliation);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── History of past reconciliations ──────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const records = await Reconciliation.find().sort('-date').limit(60);
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;