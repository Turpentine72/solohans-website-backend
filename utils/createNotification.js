import Notification from '../models/Notification.js';
import User from '../models/User.js';

let cachedAdminId = null;

async function getAdminUserId() {
  if (cachedAdminId) return cachedAdminId;
  const admin = await User.findOne({ role: 'admin' });
  if (admin) cachedAdminId = admin._id;
  return cachedAdminId;
}

export default async function createNotification({ type, message, relatedId, userId }) {
  try {
    const user = userId || await getAdminUserId();
    if (!user) {
      console.error('Cannot create notification – no admin user found');
      return;
    }
    await Notification.create({
      user,
      type,
      message,
      relatedId: relatedId || null,
    });
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}