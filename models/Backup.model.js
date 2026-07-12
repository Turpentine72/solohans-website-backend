import mongoose from 'mongoose';

const backupSchema = new mongoose.Schema({
  type: { type: String, enum: ['manual', 'scheduled', 'pre-restore-safety', 'pre-reset-safety'], default: 'manual' },
  frequency: { type: String, enum: ['daily', 'weekly', 'monthly', null], default: null },
  createdBy: { type: String, default: 'system' },
  fileId: { type: mongoose.Schema.Types.ObjectId, required: true }, // GridFS file id
  filename: { type: String, required: true },
  sizeBytes: { type: Number, default: 0 },
  counts: { type: mongoose.Schema.Types.Mixed, default: {} }, // { orders: 1234, users: 12, ... }
  status: { type: String, enum: ['completed', 'failed'], default: 'completed' },
  lastRestoredAt: { type: Date, default: null }, // set when this backup is used to restore
}, { timestamps: true });

export default mongoose.model('Backup', backupSchema);