import AuditLog from '../models/AuditLog.js';

export async function logAudit({ userId, userEmail, action, details }) {
  try {
    await AuditLog.create({ user: userId, userEmail, action, details });
  } catch (err) {
    console.error('Audit log error (non-fatal):', err.message);
  }
}