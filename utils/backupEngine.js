// backend/utils/backupEngine.js
import mongoose from 'mongoose';
import zlib from 'zlib';
import { promisify } from 'util';
import { Readable } from 'stream';

import User from '../models/User.js';
import Order from '../models/Order.js';
import MenuItem from '../models/MenuItem.js';
import Ingredient from '../models/Ingredient.js';
import Inventory from '../models/Inventory.js';
import Expense from '../models/Expense.js';
import Category from '../models/Category.js';
import Role from '../models/Role.js';
import Settings from '../models/Settings.js';
import StockMovement from '../models/StockMovement.js';
import DailyStock from '../models/DailyStock.js';
import Reconciliation from '../models/Reconciliation.js';
import Promo from '../models/Promo.js';
import Review from '../models/Review.js';
import DeliveryZone from '../models/DeliveryZone.js';
import Attendance from '../models/Attendance.js';
import Counter from '../models/Counter.js';
import AuditLog from '../models/AuditLog.js';
import Contact from '../models/Contact.js';
import Gallery from '../models/Gallery.js';
import Backup from '../models/Backup.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// ✅ Every collection a backup covers — Orders (which double as Customers,
// since there's no separate Customer model), Staff (Users), Inventory,
// Ingredients, Meals (MenuItem), Settings, User Accounts, Roles, and
// Permissions (Role.permissions is part of the Role document already).
// Deliberately excludes Otp (ephemeral, sensitive) and Notification
// (ephemeral, not business-critical).
const COLLECTIONS = {
  users: User,
  orders: Order,
  menuItems: MenuItem,
  ingredients: Ingredient,
  inventory: Inventory,
  expenses: Expense,
  categories: Category,
  roles: Role,
  settings: Settings,
  stockMovements: StockMovement,
  dailyStocks: DailyStock,
  reconciliations: Reconciliation,
  promos: Promo,
  reviews: Review,
  deliveryZones: DeliveryZone,
  attendances: Attendance,
  counters: Counter,
  auditLogs: AuditLog,
  contacts: Contact,
  gallery: Gallery,
};

export class BackupError extends Error {}

function getBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'backups' });
}

// ─── CREATE ───────────────────────────────────────────────────────────
export async function createBackup({ type = 'manual', frequency = null, createdBy = 'system' }) {
  const data = {};
  const counts = {};
  for (const [key, Model] of Object.entries(COLLECTIONS)) {
    const docs = await Model.find().lean();
    data[key] = docs;
    counts[key] = docs.length;
  }

  const payload = JSON.stringify({ createdAt: new Date().toISOString(), collections: Object.keys(COLLECTIONS), data });
  const compressed = await gzip(Buffer.from(payload, 'utf8'));

  const bucket = getBucket();
  const filename = `backup-${Date.now()}.json.gz`;
  const uploadStream = bucket.openUploadStream(filename);
  const fileId = uploadStream.id;

  await new Promise((resolve, reject) => {
    Readable.from(compressed).pipe(uploadStream).on('error', reject).on('finish', resolve);
  });

  const backup = await Backup.create({
    type,
    frequency,
    createdBy,
    fileId,
    filename,
    sizeBytes: compressed.length,
    counts,
    status: 'completed',
  });

  return backup;
}

// ─── LIST ─────────────────────────────────────────────────────────────
export async function listBackups() {
  return Backup.find().sort({ createdAt: -1 });
}

// ─── DOWNLOAD ─────────────────────────────────────────────────────────
export function downloadStream(fileId) {
  const bucket = getBucket();
  return bucket.openDownloadStream(new mongoose.Types.ObjectId(fileId));
}

// ─── RESTORE ──────────────────────────────────────────────────────────
// Wipes and reinserts every covered collection from the chosen backup.
// A fresh "pre-restore safety" backup is always taken first, so a bad
// restore is itself reversible by restoring that safety snapshot.
export async function restoreBackup(backupId, { performedBy = 'system' } = {}) {
  const backup = await Backup.findById(backupId);
  if (!backup) throw new BackupError('Backup not found.');

  // 🛟 Safety net — snapshot current state before touching anything.
  const safetyBackup = await createBackup({ type: 'pre-restore-safety', createdBy: performedBy });

  const bucket = getBucket();
  const chunks = [];
  await new Promise((resolve, reject) => {
    bucket.openDownloadStream(backup.fileId)
      .on('data', (c) => chunks.push(c))
      .on('error', reject)
      .on('end', resolve);
  });
  const decompressed = await gunzip(Buffer.concat(chunks));
  const parsed = JSON.parse(decompressed.toString('utf8'));

  const results = {};
  for (const [key, Model] of Object.entries(COLLECTIONS)) {
    const docs = parsed.data?.[key];
    if (!Array.isArray(docs)) { results[key] = 'skipped (not in backup)'; continue; }
    try {
      await Model.deleteMany({});
      if (docs.length) await Model.insertMany(docs, { ordered: false });
      results[key] = `restored ${docs.length}`;
    } catch (err) {
      results[key] = `FAILED: ${err.message}`;
    }
  }

  backup.lastRestoredAt = new Date();
  await backup.save();

  return { restoredFrom: backup, safetyBackup, results };
}

// ─── SCHEDULING ───────────────────────────────────────────────────────
// Simple, dependency-free scheduler — checked hourly from server.js via
// setInterval (see maybeRunScheduledBackup). No cron package needed.
export async function maybeRunScheduledBackup() {
  const settings = await Settings.findOne();
  const schedule = settings?.backupSchedule;
  if (!schedule?.enabled) return;

  const now = new Date();
  const last = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null;
  const msSince = last ? now - last : Infinity;

  const THRESHOLDS = { daily: 23 * 3600 * 1000, weekly: 6.5 * 24 * 3600 * 1000, monthly: 27 * 24 * 3600 * 1000 };
  const threshold = THRESHOLDS[schedule.frequency];
  if (!threshold || msSince < threshold) return;

  await createBackup({ type: 'scheduled', frequency: schedule.frequency, createdBy: 'scheduler' });
  await Settings.updateOne({ _id: settings._id }, { $set: { 'backupSchedule.lastRunAt': now } });
}
