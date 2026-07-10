import express from 'express';
import Expense from '../models/Expense.js';
import { protect, requirePermission } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();

// admin and closing_staff can manage expenses — matches the "Daily Closing →
// Expenses" responsibility from the closing staff role spec.
router.use(protect, requirePermission('expenses', 'view'));

// ─── List expenses (optionally filtered by date range) ────────────────────
router.get('/', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = {};
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) filter.date.$lte = new Date(to);
    }
    const expenses = await Expense.find(filter).sort('-date').limit(1000);
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Create an expense ─────────────────────────────────────────────────────
router.post('/', requirePermission('expenses', 'create'), async (req, res) => {
  try {
    const { date, category, amount, description } = req.body;
    if (!category || !amount) {
      return res.status(400).json({ message: 'Category and amount are required' });
    }
    const expense = await Expense.create({
      date: date ? new Date(date) : new Date(),
      category,
      amount: Number(amount),
      description: description || '',
      addedBy: req.user.id,
    });

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Expense Logged',
      details: `${category} — ₦${Number(amount).toLocaleString()}`,
    });

    res.status(201).json(expense);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── Update an expense ─────────────────────────────────────────────────────
router.put('/:id', requirePermission('expenses', 'edit'), async (req, res) => {
  try {
    const { date, category, amount, description } = req.body;
    const expense = await Expense.findByIdAndUpdate(
      req.params.id,
      { date: date ? new Date(date) : undefined, category, amount: amount !== undefined ? Number(amount) : undefined, description },
      { new: true, omitUndefined: true }
    );
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json(expense);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── Delete an expense — admin only ────────────────────────────────────────
router.delete('/:id', requirePermission('expenses', 'delete'), async (req, res) => {
  try {
    await Expense.findByIdAndDelete(req.params.id);
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;