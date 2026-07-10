import express from 'express';
import { protect } from '../middleware/auth.js';
import Settings from '../models/Settings.js';
import { logAudit } from '../utils/auditLog.js';
import Backup from '../models/Backup.model.js';
import { createBackup, listBackups, downloadStream, restoreBackup, BackupError } from '../utils/backupEngine.js';

const router = express.Router();
router.use(protect);

// 🔒 Every route here is Super Admin only — backups contain everything,
// including User accounts, and restore is the single most destructive
// action in the whole system.
function requireSuperAdmin(req, res, next) {
  if (!req.user?.isSuperAdmin) {
    console.warn(`⚠️ Backup route blocked — ${req.user?.email || 'unknown user'} is not a Super Admin. Attempted: ${req.method} ${req.originalUrl}`);
    return res.status(403).json({ message: 'Only a Super Admin can manage backups.' });
  }
  next();
}
router.use(requireSuperAdmin);

// ─── List backup history ───────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    console.log(`[backup] listing backup history — requested by ${req.user.email}`);
    const backups = await listBackups();
    console.log(`[backup] found ${backups.length} backup record(s)`);
    res.json(backups);
  } catch (err) {
    console.error('❌ [backup] Failed to list backup history:', err);
    res.status(500).json({ message: `Couldn't load backup history: ${err.message}` });
  }
});

// ─── Create a manual backup now ────────────────────────────────────
router.post('/manual', async (req, res) => {
  const startedAt = Date.now();
  try {
    console.log(`[backup] manual backup starting — requested by ${req.user.email}`);
    const backup = await createBackup({ type: 'manual', createdBy: req.user.email });
    console.log(`[backup] manual backup completed in ${Date.now() - startedAt}ms — "${backup.filename}" (${(backup.sizeBytes / 1024).toFixed(1)} KB), counts:`, backup.counts);
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
    console.error(`❌ [backup] Manual backup FAILED after ${Date.now() - startedAt}ms:`, err);
    res.status(500).json({ message: `Backup failed: ${err.message || 'unknown error — check server logs.'}` });
  }
});

// ─── Get / update the automatic backup schedule ────────────────────
router.get('/schedule', async (req, res) => {
  try {
    console.log(`[backup] fetching schedule — requested by ${req.user.email}`);
    const settings = await Settings.findOne();
    const schedule = settings?.backupSchedule || { enabled: false, frequency: 'daily', lastRunAt: null };
    console.log('[backup] current schedule:', schedule);
    res.json(schedule);
  } catch (err) {
    console.error('❌ [backup] Failed to fetch schedule:', err);
    res.status(500).json({ message: `Couldn't load the backup schedule: ${err.message}` });
  }
});

router.put('/schedule', async (req, res) => {
  try {
    const { enabled, frequency } = req.body;
    console.log(`[backup] updating schedule — requested by ${req.user.email}, body:`, req.body);

    if (frequency && !['daily', 'weekly', 'monthly'].includes(frequency)) {
      console.warn(`⚠️ [backup] rejected invalid frequency: "${frequency}"`);
      return res.status(400).json({ message: `"${frequency}" isn't a valid frequency — use daily, weekly, or monthly.` });
    }

    let settings = await Settings.findOne();
    if (!settings) {
      console.log('[backup] no Settings document exists yet — creating one');
      settings = await Settings.create({});
    }

    settings.backupSchedule = {
      enabled: !!enabled,
      frequency: frequency || settings.backupSchedule?.frequency || 'daily',
      lastRunAt: settings.backupSchedule?.lastRunAt || null,
    };
    await settings.save();
    console.log('[backup] schedule saved successfully:', settings.backupSchedule);

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Backup Schedule Updated',
      details: `Automatic backups ${enabled ? `enabled (${settings.backupSchedule.frequency})` : 'disabled'}`,
    });

    res.json(settings.backupSchedule);
  } catch (err) {
    // ✅ This is the exact route that was previously failing with a bare
    // "API error" on the frontend. Whatever the real cause turns out to
    // be (a Mongo write error, a validation error, a connection blip),
    // it will now show up here in full, both in Render's logs and in the
    // JSON response the frontend actually displays.
    console.error('❌ [backup] Failed to update schedule:', err);
    res.status(500).json({ message: `Couldn't save the backup schedule: ${err.message || 'unknown error — check server logs.'}` });
  }
});

// ─── Download a backup file ─────────────────────────────────────────
router.get('/:id/download', async (req, res) => {
  try {
    console.log(`[backup] download requested for ${req.params.id} by ${req.user.email}`);

    // Confirm the backup record actually exists BEFORE opening the GridFS
    // stream and setting download headers — otherwise a stream-level
    // error after headers are already sent can only end the response
    // with no body, which isn't valid JSON and looks like nothing
    // happened on the frontend.
    const backup = await Backup.findById(req.params.id).catch(() => null);
    if (!backup) {
      console.warn(`⚠️ [backup] download failed — no backup record found for id ${req.params.id}`);
      return res.status(404).json({ message: 'That backup no longer exists.' });
    }

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
    downloadStream(backup.fileId)
      .on('error', (streamErr) => {
        console.error(`❌ [backup] GridFS stream error while downloading ${req.params.id}:`, streamErr);
        if (!res.headersSent) res.status(500).json({ message: `Download failed: ${streamErr.message}` });
        else res.end(); // headers already sent — best we can do is end the stream
      })
      .pipe(res);
  } catch (err) {
    console.error(`❌ [backup] Download route failed for ${req.params.id}:`, err);
    res.status(500).json({ message: `Download failed: ${err.message}` });
  }
});

// ─── Restore from a backup — the big red button ─────────────────────
router.post('/:id/restore', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { confirm } = req.body;
    console.log(`[backup] restore requested for ${req.params.id} by ${req.user.email}`);

    if (confirm !== 'RESTORE') {
      console.warn(`⚠️ [backup] restore rejected — confirmation phrase missing/incorrect`);
      return res.status(400).json({ message: 'Type RESTORE exactly to confirm this action.' });
    }

    const { safetyBackup, results } = await restoreBackup(req.params.id, { performedBy: req.user.email });
    console.log(`[backup] restore completed in ${Date.now() - startedAt}ms. Per-collection results:`, results);

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'BACKUP RESTORED',
      details: `Restored backup ${req.params.id}. A safety snapshot ("${safetyBackup.filename}") was taken first.`,
    });

    res.json({ message: 'Restore complete.', safetyBackupId: safetyBackup._id, results });
  } catch (err) {
    if (err instanceof BackupError) {
      console.warn(`⚠️ [backup] restore rejected: ${err.message}`);
      return res.status(400).json({ message: err.message });
    }
    console.error(`❌ [backup] Restore FAILED after ${Date.now() - startedAt}ms:`, err);
    res.status(500).json({ message: `Restore failed: ${err.message || 'unknown error — check server logs.'}` });
  }
});

export default router;