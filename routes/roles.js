import express from 'express';
import Role from '../models/Role.js';
import { protect, requireRole } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();

// These six exist because specific pages/routes in the system check for
// these exact role names (e.g. Kitchen page checks for 'chef'). They're
// seeded automatically so they always show up in the dropdown, and they
// can't be deleted from here — only custom roles added by an admin can.
const BUILT_IN_ROLES = [
  { name: 'admin', label: 'Admin' },
  { name: 'cashier', label: 'Cashier' },
  { name: 'storekeeper', label: 'Store Keeper' },
  { name: 'closing_staff', label: 'Closing Staff' },
  { name: 'chef', label: 'Chef' },
  { name: 'delivery_staff', label: 'Delivery Staff' },
];

async function ensureBuiltInRoles() {
  for (const role of BUILT_IN_ROLES) {
    await Role.findOneAndUpdate(
      { name: role.name },
      { ...role, builtIn: true },
      { upsert: true }
    );
  }
}

// Any logged-in staff can view the role list (needed for dropdowns).
router.get('/', protect, async (req, res) => {
  try {
    await ensureBuiltInRoles();
    const roles = await Role.find().sort('label');
    res.json(roles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Only admin can create new custom roles.
router.post('/', protect, requireRole('admin'), async (req, res) => {
  try {
    const { label } = req.body;
    if (!label || !label.trim()) {
      return res.status(400).json({ message: 'A role name is required' });
    }
    const name = label.trim().toLowerCase().replace(/\s+/g, '_');
    const existing = await Role.findOne({ name });
    if (existing) return res.status(400).json({ message: 'A role with this name already exists' });

    const role = await Role.create({ name, label: label.trim(), builtIn: false });

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Role Created',
      details: `Created new role "${role.label}"`,
    });

    res.status(201).json(role);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Only admin can delete a CUSTOM role — built-in ones are protected since
// removing them would break hardcoded permission checks elsewhere.
router.delete('/:id', protect, requireRole('admin'), async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: 'Role not found' });
    if (role.builtIn) {
      return res.status(400).json({ message: 'Built-in roles cannot be deleted, since other parts of the system depend on them existing.' });
    }
    await role.deleteOne();

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Role Deleted',
      details: `Deleted custom role "${role.label}"`,
    });

    res.json({ message: 'Role deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
