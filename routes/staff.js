import express from 'express';
import User from '../models/User.js';
import Role from '../models/Role.js';
import { protect, requireRole } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';
import { sendPasswordChangeAlertToAdmin } from '../utils/emailTemplates.js';

const router = express.Router();

// All staff routes are admin-only.
router.use(protect, requireRole('admin'));

// ─── List all staff ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const staff = await User.find().select('-password').sort('-createdAt');
    res.json(staff);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Create a new staff account ───────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(400).json({ message: 'A staff account with this email already exists' });

    // ✅ Role must be one that actually exists (built-in or admin-created
    // custom role) — no more silently falling back to "cashier" if the
    // submitted value wasn't recognized.
    const roleDoc = await Role.findOne({ name: role });
    if (!roleDoc) {
      return res.status(400).json({ message: 'Please choose a valid role' });
    }

    const user = await User.create({
      name: name || '',
      email,
      password,
      role: roleDoc.name,
    });

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Staff Created',
      details: `Created staff account for ${user.email} with role "${user.role}"`,
    });

    res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── Update a staff member's name and/or email ────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Staff not found' });

    if (email && email.toLowerCase().trim() !== user.email) {
      const existing = await User.findOne({ email: email.toLowerCase().trim() });
      if (existing) return res.status(400).json({ message: 'Another staff account already uses this email' });
      user.email = email.toLowerCase().trim();
    }
    if (name !== undefined) user.name = name;

    await user.save();

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Staff Details Updated',
      details: `Updated name/email for ${user.email}`,
    });

    res.json({ id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── Change a staff member's role ─────────────────────────────────────────
router.patch('/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    const roleDoc = await Role.findOne({ name: role });
    if (!roleDoc) {
      return res.status(400).json({ message: 'Please choose a valid role' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Staff not found' });

    const previousRole = user.role;
    user.role = role;
    await user.save();

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Staff Role Changed',
      details: `Changed ${user.email}'s role from "${previousRole}" to "${role}"`,
    });

    res.json({ id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── Admin resets a staff member's password ───────────────────────────────
router.patch('/:id/reset-password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Staff not found' });

    user.password = newPassword; // pre-save hook hashes it
    await user.save();

    sendPasswordChangeAlertToAdmin({ staffName: user.name, staffEmail: user.email })
      .catch(err => console.error('Password change alert email error:', err));

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Staff Password Reset (by admin)',
      details: `Admin reset the password for ${user.email}`,
    });

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── Delete a staff account ───────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Staff not found' });

    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }

    await User.findByIdAndDelete(req.params.id);

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Staff Deleted',
      details: `Deleted staff account ${user.email}`,
    });

    res.json({ message: 'Staff deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;