import express from 'express';
import AuditLog from '../models/AuditLog.js';
import { protect, requireRole } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();

router.get('/', protect, requireRole('admin'), async (req, res) => {
  try {
    const logs = await AuditLog.find().sort('-timestamp').limit(200);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Clear / Reset Audit Log ────────────────────────────────────────────
// NOTE: gated to role 'admin' for now, since this system doesn't yet have
// a distinct "Super Admin" tier separate from a staff-assigned 'admin'
// role — that's part of the larger RBAC overhaul, not built here. Once
// that exists, tighten this to requireRole('superadmin') only.
router.delete('/', protect, requireRole('admin'), async (req, res) => {
  try {
    const { deletedCount } = await AuditLog.deleteMany({});
    // The clear action itself becomes the first entry in the fresh log —
    // otherwise there'd be no record that a clear ever happened, which
    // defeats the point of an audit trail.
    await logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Audit Log Cleared',
      details: `Cleared ${deletedCount} audit log record(s).`,
    });
    res.json({ message: 'Audit log cleared', deletedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;