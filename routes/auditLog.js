import express from 'express';
import AuditLog from '../models/AuditLog.js';
import { protect, requirePermission } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();

router.get('/', protect, requirePermission('audit_log', 'view'), async (req, res) => {
  try {
    const logs = await AuditLog.find().sort('-timestamp').limit(200);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Clear / Reset Audit Log — Super Admin ONLY, per spec ───────────────
// Deliberately NOT requirePermission() here — this is one of the few
// actions the spec says must be restricted to the Super Admin specifically,
// not configurable per-role like everything else.
router.delete('/', protect, async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ message: 'Only a Super Admin can clear the audit log.' });
  }
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