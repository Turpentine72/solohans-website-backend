import express from 'express';
import Attendance from '../models/Attendance.js';
import { protect, requireRole } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Get my attendance status for today ───────────────────────────────────
router.get('/today', protect, async (req, res) => {
  try {
    const record = await Attendance.findOne({ user: req.user.id, date: startOfToday() });
    res.json(record || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Start Work (check-in) ─────────────────────────────────────────────────
router.post('/check-in', protect, async (req, res) => {
  try {
    const today = startOfToday();
    let record = await Attendance.findOne({ user: req.user.id, date: today });

    if (record && record.status === 'Completed') {
      return res.status(400).json({ message: 'You already finished work for today.' });
    }
    if (record && record.checkIn) {
      return res.status(400).json({ message: 'You are already checked in.' });
    }

    if (!record) {
      record = await Attendance.create({
        user: req.user.id,
        name: req.user.name || req.user.email,
        role: req.user.role,
        date: today,
        checkIn: new Date(),
        status: 'Active',
      });
    } else {
      record.checkIn = new Date();
      record.status = 'Active';
      await record.save();
    }

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Checked In',
      details: `${req.user.name || req.user.email} started work`,
    });

    res.json(record);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── Finish For Today (check-out) ──────────────────────────────────────────
router.post('/check-out', protect, async (req, res) => {
  try {
    const { tasksCompleted } = req.body;
    const today = startOfToday();
    const record = await Attendance.findOne({ user: req.user.id, date: today });

    if (!record || !record.checkIn) {
      return res.status(400).json({ message: 'You need to start work before finishing.' });
    }
    if (record.status === 'Completed') {
      return res.status(400).json({ message: 'You already finished work for today.' });
    }

    record.checkOut = new Date();
    record.hoursWorked = Math.round(((record.checkOut - record.checkIn) / 3600000) * 100) / 100;
    record.tasksCompleted = tasksCompleted || '';
    record.status = 'Completed'; // 🔒 locked — can't be reopened for today
    await record.save();

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Checked Out',
      details: `${req.user.name || req.user.email} finished work — ${record.hoursWorked}h logged`,
    });

    res.json(record);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── Admin: Staff History with filters ──────────────────────────────────────
router.get('/history', protect, requireRole('admin'), async (req, res) => {
  try {
    const { date, role, status } = req.query;
    const filter = {};
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      filter.date = { $gte: start, $lt: end };
    }
    if (role) filter.role = role;
    if (status) filter.status = status;

    const records = await Attendance.find(filter).sort('-date').limit(500);
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
