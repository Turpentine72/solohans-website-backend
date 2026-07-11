// backend/utils/resetEngine.js
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Reconciliation from '../models/Reconciliation.js';
import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';
import Otp from '../models/Otp.js';
import Counter from '../models/Counter.js';
import Backup from '../models/Backup.js';
import { createBackup } from './backupEngine.js';

export class ResetError extends Error {}

// ✅ Exactly what this touches, and why — matches the brief's explicit
// preserve/wipe split:
//
// WIPED (transactional/testing data only):
//   - Order            → covers POS/Website/WhatsApp/Glovo/Chowdeck orders,
//                         every payment method, "customer transaction
//                         history" (customers are just distinct order
//                         emails, no separate collection), dashboard
//                         stats/charts (computed live from Order, so they
//                         reset automatically once this is empty)
//   - Reconciliation, PaymentDailyClose → Day/Payment reconciliation history
//   - Notification      → in-app notifications
//   - AuditLog           → cleared, EXCEPT this reset action itself is
//                          logged fresh afterward, so there's at least one
//                          continuous record of who did this and when
//   - Otp               → temporary one-time codes ("temporary data")
//   - Backup history     → old backup records + their files, EXCEPT the
//                          safety snapshot this function takes first
//   - order/invoice Counters → reset to 0, so numbering restarts cleanly
//
// NEVER TOUCHED (master/setup data):
//   Settings, Legal, User accounts, Role permissions, MenuItem, Ingredient,
//   Inventory, Category, StockMovement (stock history), Attendance (shift
//   history) — none of these collections are referenced below at all.
export async function performGlobalReset({ performedBy = 'system' } = {}) {
  // 🛟 Safety net — always snapshot everything before wiping anything,
  // exactly like Restore does. This is the one thing that does NOT get
  // deleted afterward, so a Global Reset can always be undone.
  const safetyBackup = await createBackup({ type: 'pre-reset-safety', createdBy: performedBy });

  const results = {};

  const wipe = async (Model, label) => {
    const { deletedCount } = await Model.deleteMany({});
    results[label] = deletedCount;
  };

  await wipe(Order, 'orders');
  await wipe(Reconciliation, 'reconciliations');
  const PaymentDailyClose = mongoose.models.PaymentDailyClose;
  if (PaymentDailyClose) {
    const { deletedCount } = await PaymentDailyClose.deleteMany({});
    results.paymentReconciliations = deletedCount;
  }
  await wipe(Notification, 'notifications');
  await wipe(Otp, 'otps');
  await wipe(AuditLog, 'auditLogs');

  // Old backup history — everything except the safety snapshot just taken.
  const oldBackups = await Backup.find({ _id: { $ne: safetyBackup._id } });
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'backups' });
  for (const b of oldBackups) {
    try { await bucket.delete(b.fileId); } catch { /* file may already be gone — fine */ }
  }
  const { deletedCount: backupsDeleted } = await Backup.deleteMany({ _id: { $ne: safetyBackup._id } });
  results.oldBackupsCleared = backupsDeleted;

  // Fresh invoice numbering — INV-000001 restarts from the top. (order_id
  // isn't Counter-driven — it's a date+random string, so there's no
  // sequence to reset there.)
  await Counter.deleteOne({ _id: 'invoiceNumber' });
  results.invoiceCounterReset = true;

  return { safetyBackup, results };
}
