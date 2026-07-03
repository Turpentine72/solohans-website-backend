// backend/routes/reconciliation.js
import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/auth.js';
import Order from '../models/Order.js';

const dailyCloseSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // YYYY-MM-DD
  expected: {
    cashTotal: Number, transferTotal: Number, posTotal: Number, websitePaymentTotal: Number, totalSales: Number,
  },
  actual: {
    cashTotal: Number, transferTotal: Number, posTotal: Number, websitePaymentTotal: Number,
  },
  variance: {
    cashTotal: Number, transferTotal: Number, posTotal: Number, websitePaymentTotal: Number,
  },
  closedBy: { type: String, default: '' },
}, { timestamps: true });

const DailyClose = mongoose.models.DailyClose || mongoose.model('DailyClose', dailyCloseSchema);

const router = express.Router();

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function expectedTotalsForToday() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const orders = await Order.find({ isDeleted: false, payment_status: 'paid', createdAt: { $gte: since } });

  const expected = { cashTotal: 0, transferTotal: 0, posTotal: 0, websitePaymentTotal: 0 };
  orders.forEach((o) => {
    if (o.paymentMethod === 'CASH') expected.cashTotal += o.totalAmount || 0;
    else if (o.paymentMethod === 'TRANSFER') expected.transferTotal += o.totalAmount || 0;
    else if (o.paymentMethod === 'POS') expected.posTotal += o.totalAmount || 0;
    else if (o.paymentMethod === 'WEBSITE PAYMENT') expected.websitePaymentTotal += o.totalAmount || 0;
  });
  expected.totalSales = expected.cashTotal + expected.transferTotal + expected.posTotal + expected.websitePaymentTotal;
  return expected;
}

// ─── GET expected totals for today (compare against physical cash / POS account / bank / Paystack) ──
router.get('/expected', protect, async (req, res) => {
  try {
    const expected = await expectedTotalsForToday();
    const existing = await DailyClose.findOne({ date: todayKey() });
    res.json({ date: todayKey(), expected, isClosed: !!existing, closedRecord: existing || null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST close the day with staff-counted actual amounts ────────
router.post('/close-day', protect, async (req, res) => {
  try {
    const date = todayKey();
    const existing = await DailyClose.findOne({ date });
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

    const record = await DailyClose.create({
      date, expected, actual, variance, closedBy: req.user?.email || 'admin',
    });

    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── GET reconciliation history ──────────────────────────────────
router.get('/history', protect, async (req, res) => {
  try {
    const records = await DailyClose.find().sort({ date: -1 }).limit(90);
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;