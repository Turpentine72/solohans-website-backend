import express from 'express';
import { protect } from '../middleware/auth.js';
import Settings from '../models/Settings.js';
import { logAudit } from '../utils/auditLog.js';
import { createBackup, listBackups, downloadStream, restoreBackup, BackupError } from '../utils/backupEngine.js';

const router = express.Router();
router.use(protect);

// 🔒 Every route here is Super Admin only — backups contain everything,
// including User accounts, and restore is the single most destructive
// action in the whole system.
function requireSuperAdmin(req, res, next) {
  if (!req.user?.isSuperAdmin) {
    return res.status(403).json({ message: 'Only a Super Admin can manage backups.' });
  }
  next();
}
router.use(requireSuperAdmin);

// ─── List backup history ───────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const backups = await listBackups();
    res.json(backups);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Create a manual backup now ────────────────────────────────────
router.post('/manual', async (req, res) => {
  try {
    const backup = await createBackup({ type: 'manual', createdBy: req.user.email });
    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Manual Backup Created',
      details: `Created backup "${backup.filename}" (${(backup.sizeBytes / 1024).toFixed(1)} KB)`,
    });
    res.status(201).json(backup);
  } catch (err) {
    // ✅ Always log server-side — a backup failure with no trace in the
    // logs is unfixable. Check Render's log viewer for this line if a
    // backup fails; it'll show the real cause (Mongo error, GridFS error,
    // out-of-memory, etc.) that the generic client-facing message can't.
    console.error('❌ Manual backup failed:', err);
    res.status(500).json({ message: err.message || 'Backup failed — check server logs for details.' });
  }
});

// ─── Get / update the automatic backup schedule ────────────────────
router.get('/schedule', async (req, res) => {
  try {
    const settings = await Settings.findOne();
    res.json(settings?.backupSchedule || { enabled: false, frequency: 'daily', lastRunAt: null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/schedule', async (req, res) => {
  try {
    const { enabled, frequency } = req.body;
    if (frequency && !['daily', 'weekly', 'monthly'].includes(frequency)) {
      return res.status(400).json({ message: 'frequency must be daily, weekly, or monthly.' });
    }
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    settings.backupSchedule = {
      enabled: !!enabled,
      frequency: frequency || settings.backupSchedule?.frequency || 'daily',
      lastRunAt: settings.backupSchedule?.lastRunAt || null,
    };
    await settings.save();

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Backup Schedule Updated',
      details: `Automatic backups ${enabled ? `enabled (${settings.backupSchedule.frequency})` : 'disabled'}`,
    });

    res.json(settings.backupSchedule);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Download a backup file ─────────────────────────────────────────
router.get('/:id/download', async (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${req.params.id}.json.gz"`);
    downloadStream(req.params.id)
      .on('error', () => res.status(404).end())
      .pipe(res);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Restore from a backup — the big red button ─────────────────────
router.post('/:id/restore', async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== 'RESTORE') {
      return res.status(400).json({ message: 'Confirmation phrase missing or incorrect.' });
    }

    const { safetyBackup, results } = await restoreBackup(req.params.id, { performedBy: req.user.email });

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'BACKUP RESTORED',
      details: `Restored backup ${req.params.id}. A safety snapshot ("${safetyBackup.filename}") was taken first.`,
    });

    res.json({ message: 'Restore complete.', safetyBackupId: safetyBackup._id, results });
  } catch (err) {
    if (err instanceof BackupError) return res.status(400).json({ message: err.message });
    console.error('Restore error:', err);
    res.status(500).json({ message: err.message });
  }
});

export default router;