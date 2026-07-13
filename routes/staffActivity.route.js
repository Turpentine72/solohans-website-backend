import express from 'express';
import { protect } from '../middleware/auth.js';
import AuditLog from '../models/AuditLog.js';
import Attendance from '../models/Attendance.js';
import Order from '../models/Order.js';

const router = express.Router();

// 🔒 Admin + Super Admin only, per spec — distinct from other permission-
// gated pages, since staff activity (logins, receipts printed, discounts
// given) is sensitive oversight data, not something delegatable via the
// normal per-module permission system.
router.use(protect, (req, res, next) => {
  if (req.user.role !== 'admin' && !req.user.isSuperAdmin) {
    return res.status(403).json({ message: 'Only an Admin or Super Admin can view Staff Activity.' });
  }
  next();
});

// Action types that come straight from the Audit Log and are relevant to
// an individual staff member's activity (as opposed to system-wide config
// changes like Role/Ingredient/Backup management, which stay on the
// separate general Audit Log page).
const STAFF_RELEVANT_ACTIONS = [
  'Login', 'Logout', 'Password Reset (OTP)', 'Staff Password Reset (by admin)',
  'Receipt Printed', 'Receipt Reprinted',
];

router.get('/', async (req, res) => {
  try {
    const { dateFrom, dateTo, staffEmail, search } = req.query;

    const start = dateFrom ? new Date(`${dateFrom}T00:00:00`) : (() => { const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d; })();
    const end = dateTo ? new Date(`${dateTo}T23:59:59`) : new Date();

    // ─── 1. Audit log events (login/logout/password/receipt prints) ──
    const auditQuery = { action: { $in: STAFF_RELEVANT_ACTIONS }, timestamp: { $gte: start, $lte: end } };
    if (staffEmail) auditQuery.userEmail = staffEmail;
    const auditEvents = await AuditLog.find(auditQuery).sort('-timestamp');

    // ─── 2. Shift records (Shift Started / Shift Ended) ───────────────
    const attendanceQuery = { date: { $gte: start, $lte: end } };
    if (staffEmail) {
      // Attendance stores `name`, not email — resolve via name match is
      // unreliable, so only apply this filter when not staff-scoped and
      // let the frontend cross-reference by name where needed.
    }
    const shifts = await Attendance.find(attendanceQuery).sort('-date');

    // ─── 3. Order-derived activity (processed orders, discounts given) ─
    const orderQuery = { isDeleted: { $ne: true }, payment_status: 'paid', createdAt: { $gte: start, $lte: end }, staffNameSnapshot: { $ne: '' } };
    const orders = await Order.find(orderQuery).select('order_id staffNameSnapshot staffId totalAmount discount_amount discount_label createdAt platform');

    // Build the unified, chronological event feed.
    const events = [];

    auditEvents.forEach((a) => {
      events.push({
        timestamp: a.timestamp,
        staffEmail: a.userEmail,
        staffName: a.userEmail,
        type: a.action,
        description: a.details || a.action,
      });
    });

    shifts.forEach((s) => {
      if (s.checkIn) {
        events.push({ timestamp: s.checkIn, staffName: s.name, staffEmail: '', type: 'Shift Started', description: `${s.name} started their shift` });
      }
      if (s.checkOut) {
        events.push({ timestamp: s.checkOut, staffName: s.name, staffEmail: '', type: 'Shift Ended', description: `${s.name} ended their shift (${s.hoursWorked?.toFixed(1) || 0}h worked)` });
      }
    });

    // Orders — aggregate per staff per day into ONE summary event (not one
    // per order, which would flood the timeline), plus a separate event
    // for every discount given (less frequent, more worth surfacing).
    const perStaffDay = new Map(); // "staffName|YYYY-MM-DD" -> { count, revenue, name, date }
    orders.forEach((o) => {
      const dateKey = new Date(o.createdAt).toISOString().slice(0, 10);
      const key = `${o.staffNameSnapshot}|${dateKey}`;
      if (!perStaffDay.has(key)) perStaffDay.set(key, { name: o.staffNameSnapshot, dateKey, count: 0, revenue: 0 });
      const bucket = perStaffDay.get(key);
      bucket.count += 1;
      bucket.revenue += o.totalAmount || 0;

      if (o.discount_amount > 0) {
        events.push({
          timestamp: o.createdAt,
          staffName: o.staffNameSnapshot,
          staffEmail: '',
          type: 'Discount Applied',
          description: `${o.staffNameSnapshot} applied a ₦${o.discount_amount.toLocaleString()} discount (${o.discount_label || 'no reason given'}) on order ${o.order_id}`,
        });
      }
    });
    for (const bucket of perStaffDay.values()) {
      events.push({
        timestamp: new Date(`${bucket.dateKey}T12:00:00`), // midday placeholder so it sorts sensibly within the day
        staffName: bucket.name,
        staffEmail: '',
        type: 'Orders Processed',
        description: `${bucket.name} processed ${bucket.count} order(s) totaling ₦${bucket.revenue.toLocaleString()}`,
      });
    }

    let filtered = events;
    if (staffEmail) {
      filtered = filtered.filter((e) => e.staffEmail === staffEmail || e.staffName === staffEmail);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((e) =>
        (e.staffName || '').toLowerCase().includes(q) ||
        (e.staffEmail || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q) ||
        (e.type || '').toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Summary cards
    const summary = {
      ordersProcessed: orders.length,
      revenueProcessed: orders.reduce((s, o) => s + (o.totalAmount || 0), 0),
      loginHours: shifts.reduce((s, sh) => s + (sh.hoursWorked || 0), 0),
      receiptsPrinted: auditEvents.filter((a) => a.action === 'Receipt Printed' || a.action === 'Receipt Reprinted').length,
    };

    res.json({ events: filtered, summary });
  } catch (err) {
    console.error('❌ [staff-activity] Failed to load:', err);
    res.status(500).json({ message: `Couldn't load Staff Activity: ${err.message}` });
  }
});

export default router;
