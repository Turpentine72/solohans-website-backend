// backend/routes/reconciliation.js
//
// DAY RECONCILIATION — FOOD / MEALS ONLY.
// Completely separate from routes/paymentReconciliation.js (which handles
// MONEY reconciliation). This page never touches cash, POS totals,
// transfers, or any payment method — only how many meals/portions were
// sold today, per dish.
//
// The expected number of meals sold per dish is calculated automatically
// from all of today's completed orders and sales. Staff only type in the
// actual portion count they counted at close of day — every comparison
// and every difference is calculated by the system.
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

function statusFor(difference) {
  if (difference === 0) return 'Reconciled';
  return difference > 0 ? 'Excess' : 'Shortage';
}

// ─── GET expected meals sold for today (auto-calculated, food only) ──────
router.get('/expected', async (req, res) => {
  try {
    const stock = await getOrCreateTodayStock();
    const items = stock.items.map((i) => ({
      menuItem: i.menuItem,
      name: i.name,
      expectedSold: i.sold,
    }));
    res.json({ date: stock.date, items, isClosed: stock.isClosed });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Close the day: compare actual meal counts vs expected, lock, reset ──
router.post('/close-day', requirePermission('reconciliation', 'create'), async (req, res) => {
  try {
    const { actualCounts } = req.body; // [{ menuItemId, actual }] — actual meals/portions sold, counted by staff
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
      const expectedSold = stockEntry.sold;
      const actualSold = submitted ? Number(submitted.actual) || 0 : 0;
      const difference = actualSold - expectedSold;
      if (difference !== 0) hasMismatch = true;

      items.push({
        menuItem: stockEntry.menuItem,
        name: stockEntry.name,
        expectedSold,
        actualSold,
        difference,
        status: statusFor(difference),
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
      details: `Closed day (food reconciliation) with status "${reconciliation.status}" — ${items.length} item(s) reconciled`,
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