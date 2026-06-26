import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // 🔒 "Logout all active sessions" on password change — every token
    // carries the tokenVersion it was issued under. If the user's current
    // tokenVersion has moved on (changed password), this token is dead,
    // even though it hasn't technically expired yet.
    const user = await User.findById(payload.id).select('tokenVersion');
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      return res.status(401).json({ message: 'Session expired — please log in again' });
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Token invalid or expired' });
  }
};

// Usage: router.get('/', protect, requireRole('admin'), handler)
// Must be used AFTER protect, since it relies on req.user being set.
export const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'You do not have permission to perform this action' });
  }
  next();
};