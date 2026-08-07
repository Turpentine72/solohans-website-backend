// backend/routes/paymentReconciliation.js
//
// PAYMENT RECONCILIATION — MONEY ONLY.
// Completely separate from routes/reconciliation.js (which handles FOOD /
// meal-count reconciliation). This page never touches stock, meals, or
// menu items — only cash/money collected across the 6 supported payment
// methods: Cash, POS, Transfer, Website, Glovo, Chowdeck.
//
// Everything here is automated: the "expected" amount for each method is
// calculated from today's completed (paid) orders. Staff only type in the
// amount they actually counted/received for each method — the system does
// every comparison and every naira-for-naira calculation itself.
import express from 'express';
import mongoose from 'mongoose';
import { protect, requirePermission } from '../middleware/auth.js';
import Order from '../models/Order.js';

// ─── The 6 payment methods this page reconciles ───────────────────────────
// Every "expected" total is auto-calculated from orders; every "actual"
// total is a single number staff types in. Adding/removing a method only
// ever requires touching this one array.
const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'pos', label: 'POS' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'website', label: 'Website' },
  { key: 'glovo', label: 'Glovo' },
  { key: 'chowdeck', label: 'Chowdeck' },
];
const METHOD_KEYS = PAYMENT_METHODS.map((m) => m.key);

const methodResultSchema = new mongoose.Schema({
  key: String,
  label: String,
  count: Number,
  expected: Number,
  actual: Number,
  difference: Number, // actual - expected
  status: { type: String, enum: ['Reconciled', 'Shortage', 'Excess'] },
}, { _id: false });

const dailyCloseSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // YYYY-MM-DD
  methods: [methodResultSchema],
  totalExpected: Number,
  totalActual: Number,
  totalDifference: Number,
  overallStatus: { type: String, enum: ['Reconciled', 'Shortage', 'Excess'] },
  closedBy: { type: String, default: '' },
}, { timestamps: true });

const PaymentDailyClose = mongoose.models.PaymentDailyClose || mongoose.model('PaymentDailyClose', dailyCloseSchema);

const router = express.Router();

router.use(protect, requirePermission('payment_reconciliation', 'view'));

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function statusFor(difference) {
  if (difference === 0) return 'Reconciled';
  return difference > 0 ? 'Excess' : 'Shortage';
}

// ✅ Automatically calculates the expected amount for every payment method
// from all of today's completed (paid) orders and sales — no manual entry,
// no manual math, ever.
async function expectedTotalsForToday() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const orders = await Order.find({ isDeleted: false, payment_status: 'paid', createdAt: { $gte: since } });

  const totals = Object.fromEntries(METHOD_KEYS.map((k) => [k, { expected: 0, count: 0 }]));

  const addTo = (key, amount) => {
    totals[key].expected += amount || 0;
    totals[key].count += 1;
  };

  orders.forEach((o) => {
    const amount = o.totalAmount || 0;
    if (o.paymentMethod === 'CASH') addTo('cash', amount);
    else if (o.paymentMethod === 'POS') addTo('pos', amount);
    else if (o.paymentMethod === 'TRANSFER') addTo('transfer', amount);
    else if (o.paymentMethod === 'WEBSITE PAYMENT') addTo('website', amount);
    else if (o.paymentMethod === 'PLATFORM') {
      // Only Glovo and Chowdeck are reconciled here, matching the 6
      // payment methods this page covers. Orders placed via any other
      // platform (e.g. Uber Eats, Other) are store-recorded sales but
      // aren't part of this reconciliation and are excluded from expected
      // totals here by design.
      if (o.platform === 'Glovo') addTo('glovo', amount);
      else if (o.platform === 'Chowdeck') addTo('chowdeck', amount);
    } else if (o.paymentMethod === 'SPLIT') {
      (o.splitPayments || []).forEach((sp) => {
        const spAmount = sp.amount || 0;
        if (sp.method === 'CASH') addTo('cash', spAmount);
        else if (sp.method === 'POS') addTo('pos', spAmount);
        else if (sp.method === 'TRANSFER') addTo('transfer', spAmount);
      });
    }
  });

  return totals;
}

// ─── GET expected totals for today ────────────────────────────────
router.get('/expected', async (req, res) => {
  try {
    const totals = await expectedTotalsForToday();
    const methods = PAYMENT_METHODS.map((m) => ({
      key: m.key,
      label: m.label,
      count: totals[m.key].count,
      expected: totals[m.key].expected,
    }));
    const totalExpected = methods.reduce((s, m) => s + m.expected, 0);
    const existing = await PaymentDailyClose.findOne({ date: todayKey() });
    res.json({ date: todayKey(), methods, totalExpected, isClosed: !!existing, closedRecord: existing || null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST close the day with staff-counted actual amounts ────────
// Staff only submits the amount they actually counted for each method —
// the difference and reconciliation status for every method (and the
// overall total) are computed automatically here.
router.post('/close-day', requirePermission('payment_reconciliation', 'create'), async (req, res) => {
  try {
    const date = todayKey();
    const existing = await PaymentDailyClose.findOne({ date });
    if (existing) return res.status(400).json({ message: 'Today has already been reconciled and closed.' });

    const totals = await expectedTotalsForToday();
    const actualInput = req.body.actual || {};

    const methods = PAYMENT_METHODS.map((m) => {
      const expected = totals[m.key].expected;
      const actual = Number(actualInput[m.key]) || 0;
      const difference = actual - expected;
      return {
        key: m.key,
        label: m.label,
        count: totals[m.key].count,
        expected,
        actual,
        difference,
        status: statusFor(difference),
      };
    });

    const totalExpected = methods.reduce((s, m) => s + m.expected, 0);
    const totalActual = methods.reduce((s, m) => s + m.actual, 0);
    const totalDifference = totalActual - totalExpected;

    const record = await PaymentDailyClose.create({
      date,
      methods,
      totalExpected,
      totalActual,
      totalDifference,
      overallStatus: statusFor(totalDifference),
      closedBy: req.user?.email || 'admin',
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