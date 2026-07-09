import { admin } from './firebaseAdmin.js';
import User from '../models/User.js';

// Sends a push notification to every admin's registered device.
// Designed to NEVER throw — a notification failure must never break the
// order flow that triggered it. Call this with .catch() as a safety net
// anyway, but it already swallows its own errors internally.
export async function sendPushToAdmins({ title, body, url }) {
  try {
    const admins = await User.find({
      $or: [{ role: 'admin' }, { isSuperAdmin: true }],
      fcmTokens: { $exists: true, $ne: [] },
    });
    const tokens = admins.flatMap(a => a.fcmTokens || []);
    if (tokens.length === 0) return;

    const message = {
      notification: { title, body },
      data: { url: url || '/admin/orders' },
      tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Clean up any tokens that are no longer valid (browser cleared data,
    // notifications revoked, etc.) so the list doesn't grow stale forever.
    const deadTokens = [];
    response.responses.forEach((res, i) => {
      if (!res.success) deadTokens.push(tokens[i]);
    });
    if (deadTokens.length > 0) {
      await User.updateMany(
        { $or: [{ role: 'admin' }, { isSuperAdmin: true }] },
        { $pull: { fcmTokens: { $in: deadTokens } } }
      );
    }
  } catch (err) {
    console.error('Push notification error (non-fatal):', err.message);
  }
}