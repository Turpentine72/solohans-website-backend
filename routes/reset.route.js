import express from 'express';
import { protect } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';
import { performGlobalReset, ResetError } from '../utils/resetEngine.js';

const router = express.Router();
router.use(protect);

// 🔒 Super Admin only, full stop — never delegatable through the normal
// permission system, matching the same reasoning as Backup & Restore and
// Payouts. This wipes every transaction the business has ever recorded.
router.use((req, res, next) => {
  if (!req.user?.isSuperAdmin) {
    console.warn(`⚠️ Global Reset blocked — ${req.user?.email || 'unknown'} is not a Super Admin.`);
    return res.status(403).json({ message: 'Only a Super Admin can run a Global Reset.' });
  }
  next();
});

router.post('/transactional-data', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { confirm } = req.body;
    if (confirm !== 'RESET') {
      return res.status(400).json({ message: 'Type RESET exactly to confirm this action.' });
    }

    console.log(`[global-reset] starting — requested by ${req.user.email}`);
    const { safetyBackup, results } = await performGlobalReset({ performedBy: req.user.email });
    console.log(`[global-reset] completed in ${Date.now() - startedAt}ms:`, results);

    // Logged AFTER the wipe (AuditLog itself was just cleared) — this is
    // deliberately the first entry in the fresh log, so there's always at
    // least one continuous record of who ran this and when.
    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'GLOBAL RESET EXECUTED',
      details: `Cleared all transactional data (orders, reconciliations, notifications, audit history, old backups). A safety snapshot ("${safetyBackup.filename}") was taken first and preserved. Results: ${JSON.stringify(results)}`,
    });

    res.json({ message: 'Global reset complete.', safetyBackupId: safetyBackup._id, results });
  } catch (err) {
    if (err instanceof ResetError) {
      console.error(`❌ [global-reset] ${err.message}`);
      return res.status(500).json({ message: err.message });
    }
    console.error('❌ [global-reset] Unexpected failure:', err);
    res.status(500).json({ message: `Reset failed: ${err.message || 'unknown error — check server logs.'}` });
  }
});

export default router;