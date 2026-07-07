import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Role from '../models/Role.js';

export const protect = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // 🔒 "Logout all active sessions" on password change — every token
    // carries the tokenVersion it was issued under. If the user's current
    // tokenVersion has moved on (changed password), this token is dead,
    // even though it hasn't technically expired yet.
    const user = await User.findById(payload.id).select('tokenVersion status isSuperAdmin');
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      return res.status(401).json({ message: 'Session expired — please log in again' });
    }
    if (user.status === 'Inactive') {
      return res.status(403).json({ message: 'Your account has been deactivated. Please contact the administrator.' });
    }

    // ✅ isSuperAdmin always comes fresh from the DB, never from the JWT
    // itself — so revoking it takes effect on this user's very next
    // request, not just after their token expires.
    req.user = { ...payload, isSuperAdmin: user.isSuperAdmin };
    next();
  } catch {
    res.status(401).json({ message: 'Token invalid or expired' });
  }
};

// Usage: router.get('/', protect, requireRole('admin'), handler)
// Must be used AFTER protect, since it relies on req.user being set.
export const requireRole = (...allowedRoles) => (req, res, next) => {
  if (req.user?.isSuperAdmin) return next(); // unrestricted, always
  if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'You do not have permission to perform this action' });
  }
  next();
};

// ✅ RBAC — Usage: router.post('/', protect, requirePermission('menu', 'create'), handler)
// Checks the logged-in user's ROLE's permission for a specific
// module + action. Super Admins bypass this entirely. Looked up fresh
// from the database every time (not cached in the JWT), so a permission
// change by a Super Admin takes effect on the staff member's very next
// request — no need for them to log out and back in.
export const requirePermission = (moduleName, action) => async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    if (req.user.isSuperAdmin) return next();

    const role = await Role.findOne({ name: req.user.role });
    const modulePerms = role?.permissions?.get(moduleName);
    if (!modulePerms || !modulePerms[action]) {
      return res.status(403).json({ message: `You do not have permission to ${action} ${moduleName}.` });
    }
    next();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};