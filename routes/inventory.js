// backend/routes/paymentReconciliation.js
import express from 'express';
import mongoose from 'mongoose';
import { protect, requirePermission } from '../middleware/auth.js';
import Order from '../models/Order.js';

const platformEntrySchema = new mongoose.Schema({ expected: Number, actual: Number, variance: Number, count: Number }, { _id: false });

const dailyCloseSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // YYYY-MM-DD
  expected: {
    cashTotal: Number, cashCount: Number,
    transferTotal: Number, transferCount: Number,
    posTotal: Number, posCount: Number,
    websitePaymentTotal: Number, websitePaymentCount: Number,
    totalSales: Number,
  },
  actual: {
    cashTotal: Number, transferTotal: Number, posTotal: Number, websitePaymentTotal: Number,
  },
  variance: {
    cashTotal: Number, transferTotal: Number, posTotal: Number, websitePaymentTotal: Number,
  },
  // ✅ Third-party delivery platforms — Glovo, Chowdeck, Uber Eats, Other,
  // and anything added in the future. A Map keyed by platform name means a
  // brand-new platform just works here automatically, no schema change
  // needed, matching the same "no core logic changes" design as the POS
  // platform-order feature itself.
  platformBreakdown: { type: Map, of: platformEntrySchema, default: () => ({}) },
  closedBy: { type: String, default: '' },
}, { timestamps: true });

const PaymentDailyClose = mongoose.models.PaymentDailyClose || mongoose.model('PaymentDailyClose', dailyCloseSchema);

const router = express.Router();

router.use(protect, requirePermission('payment_reconciliation', 'view'));

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Every third-party platform the POS supports — kept in sync with
// checkout.js's VALID_PLATFORMS (minus 'Walk-in', which isn't a platform).
// Always shown here, even at ₦0/0 transactions, so a platform never
// silently disappears from the reconciliation view just because it had
// no sales yet today — and so this list is the one place to extend when
// a new platform is added, matching the "no core logic changes" design.
const RECONCILABLE_PLATFORMS = ['Glovo', 'Chowdeck', 'Uber Eats', 'Other'];

async function expectedTotalsForToday() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const orders = await Order.find({ isDeleted: false, payment_status: 'paid', createdAt: { $gte: since } });

  const expected = {
    cashTotal: 0, cashCount: 0,
    transferTotal: 0, transferCount: 0,
    posTotal: 0, posCount: 0,
    websitePaymentTotal: 0, websitePaymentCount: 0,
    platformTotal: 0,
    platformBreakdown: Object.fromEntries(RECONCILABLE_PLATFORMS.map((p) => [p, { total: 0, count: 0 }])),
  };
  orders.forEach((o) => {
    if (o.paymentMethod === 'CASH') { expected.cashTotal += o.totalAmount || 0; expected.cashCount += 1; }
    else if (o.paymentMethod === 'TRANSFER') { expected.transferTotal += o.totalAmount || 0; expected.transferCount += 1; }
    else if (o.paymentMethod === 'POS') { expected.posTotal += o.totalAmount || 0; expected.posCount += 1; }
    else if (o.paymentMethod === 'WEBSITE PAYMENT') { expected.websitePaymentTotal += o.totalAmount || 0; expected.websitePaymentCount += 1; }
    else if (o.paymentMethod === 'PLATFORM') {
      // ✅ Third-party platform orders (Glovo, Chowdeck, etc.) — payment
      // was already collected by the platform, so there's nothing to
      // reconcile in the cash drawer for these. Still shown as its own
      // visible line, broken down by platform, so this revenue is never
      // invisible from the day's closing report — just not mixed into
      // cash/transfer/POS reconciliation math where it doesn't belong.
      expected.platformTotal += o.totalAmount || 0;
      const key = RECONCILABLE_PLATFORMS.includes(o.platform) ? o.platform : 'Other';
      expected.platformBreakdown[key].total += o.totalAmount || 0;
      expected.platformBreakdown[key].count += 1;
    }
    else if (o.paymentMethod === 'SPLIT') {
      (o.splitPayments || []).forEach((sp) => {
        if (sp.method === 'CASH') { expected.cashTotal += sp.amount || 0; expected.cashCount += 1; }
        else if (sp.method === 'TRANSFER') { expected.transferTotal += sp.amount || 0; expected.transferCount += 1; }
        else if (sp.method === 'POS') { expected.posTotal += sp.amount || 0; expected.posCount += 1; }
      });
    }
  });
  expected.totalSales = expected.cashTotal + expected.transferTotal + expected.posTotal + expected.websitePaymentTotal + expected.platformTotal;
  return expected;
}

// ─── GET expected totals for today ────────────────────────────────
router.get('/expected', async (req, res) => {
  try {
    const expected = await expectedTotalsForToday();
    const existing = await PaymentDailyClose.findOne({ date: todayKey() });
    res.json({ date: todayKey(), expected, isClosed: !!existing, closedRecord: existing || null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST close the day with staff-counted actual amounts ────────
router.post('/close-day', requirePermission('payment_reconciliation', 'create'), async (req, res) => {
  try {
    const date = todayKey();
    const existing = await PaymentDailyClose.findOne({ date });
    if (existing) return res.status(400).json({ message: 'Today has already been reconciled and closed.' });

    const expected = await expectedTotalsForToday();
    const actual = {
      cashTotal: Number(req.body.actualCounts?.cashTotal) || 0,
      transferTotal: Number(req.body.actualCounts?.transferTotal) || 0,
      posTotal: Number(req.body.actualCounts?.posTotal) || 0,
      websitePaymentTotal: Number(req.body.actualCounts?.websitePaymentTotal) || 0,
    };
    const variance = {
      cashTotal: actual.cashTotal - expected.cashTotal,
      transferTotal: actual.transferTotal - expected.transferTotal,
      posTotal: actual.posTotal - expected.posTotal,
      websitePaymentTotal: actual.websitePaymentTotal - expected.websitePaymentTotal,
    };

    // ✅ One row per platform actually seen today (Glovo, Chowdeck, Uber
    // Eats, Other, or anything added later) — "actual" here means what the
    // platform's own dashboard/settlement statement shows, so this catches
    // a platform under/over-paying versus what was rung up at POS.
    const actualPlatforms = req.body.actualCounts?.platformBreakdown || {};
    const platformBreakdown = {};
    for (const [platform, data] of Object.entries(expected.platformBreakdown || {})) {
      const actualAmount = Number(actualPlatforms[platform]) || 0;
      platformBreakdown[platform] = { expected: data.total, actual: actualAmount, variance: actualAmount - data.total, count: data.count };
    }

    const record = await PaymentDailyClose.create({
      date, expected, actual, variance, platformBreakdown, closedBy: req.user?.email || 'admin',
    });

    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── GET history ──────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const records = await PaymentDailyClose.find().sort({ date: -1 }).limit(90);
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;