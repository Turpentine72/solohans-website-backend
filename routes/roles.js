import express from 'express';
import Role, { PERMISSION_MODULES, PERMISSION_ACTIONS, defaultPermissionsFor } from '../models/Role.js';
import User from '../models/User.js';
import { protect, requireRole, requirePermission } from '../middleware/auth.js';
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
    const existing = await Role.findOne({ name: role.name });
    if (!existing) {
      // New install / first time seeing this role — 'admin' gets full
      // permissions on every module, other built-ins get a sensible
      // starter preset (see DEFAULT_ROLE_PRESETS) so they aren't locked
      // out of their own job on day one. Both remain fully editable by a
      // Super Admin afterward.
      const permissions = role.name === 'admin' ? fullPermissions() : defaultPermissionsFor(role.name);
      await Role.create({ ...role, builtIn: true, permissions });
    } else if (!existing.builtIn) {
      existing.builtIn = true;
      await existing.save();
    }

    // ✅ Backfill: if this built-in role already existed (e.g. from before
    // this RBAC expansion) and is missing a module that now has a preset
    // for it, add just that module — never touching any module a Super
    // Admin has already explicitly configured, existing or not.
    if (existing && role.name !== 'admin') {
      const preset = defaultPermissionsFor(role.name);
      const existingPerms = existing.permissions instanceof Map ? Object.fromEntries(existing.permissions) : (existing.permissions || {});
      let changed = false;
      for (const [mod, perms] of Object.entries(preset)) {
        if (!existingPerms[mod]) {
          existingPerms[mod] = perms;
          changed = true;
        }
      }
      if (changed) {
        existing.permissions = existingPerms;
        existing.markModified('permissions');
        await existing.save();
      }
    }

    // Admin always gets full access to every module, including any newly
    // added ones this rebuild introduces — never partially configured.
    if (existing && role.name === 'admin') {
      const existingPerms = existing.permissions instanceof Map ? Object.fromEntries(existing.permissions) : (existing.permissions || {});
      let changed = false;
      for (const mod of PERMISSION_MODULES) {
        if (!existingPerms[mod]) {
          existingPerms[mod] = Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a, true]));
          changed = true;
        }
      }
      if (changed) {
        existing.permissions = existingPerms;
        existing.markModified('permissions');
        await existing.save();
      }
    }
  }

  // ✅ One-time, idempotent safety net: if nobody has ever been flagged as
  // Super Admin, promote every existing role:'admin' account automatically.
  // Without this, the very first deploy of RBAC would lock every current
  // admin out of pages that later get gated to "Super Admin only".
  const superAdminExists = await User.exists({ isSuperAdmin: true });
  if (!superAdminExists) {
    await User.updateMany({ role: 'admin' }, { $set: { isSuperAdmin: true } });
  }
}

function fullPermissions() {
  const perms = {};
  for (const mod of PERMISSION_MODULES) {
    perms[mod] = Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a, true]));
  }
  return perms;
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

// ─── Metadata for the frontend permissions matrix ───────────────────────
router.get('/permission-schema', protect, requireRole('admin'), async (req, res) => {
  res.json({ modules: PERMISSION_MODULES, actions: PERMISSION_ACTIONS });
});

// ─── Update a role's permissions — Super Admin only ─────────────────────
// Regular 'admin' role holders can create/delete role NAMES above, but
// only a true Super Admin (User.isSuperAdmin) may change what any role
// is actually permitted to do — otherwise a non-super admin could grant
// themselves more access via a role they control.
router.patch('/:id/permissions', protect, async (req, res) => {
  try {
    if (!req.user.isSuperAdmin) {
      return res.status(403).json({ message: 'Only a Super Admin can change role permissions.' });
    }
    const { permissions } = req.body; // { [module]: { view, create, edit, ... } }
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ message: 'permissions object is required' });
    }

    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: 'Role not found' });

    // ✅ Fix: rebuild the whole permissions object from scratch and
    // reassign it, instead of mutating the existing Mongoose Map in place
    // with .set(). Maps-of-subdocument-schemas don't always get picked up
    // by save() when mutated via .set() — this sidesteps that entirely by
    // replacing the field outright, plus an explicit markModified as a
    // belt-and-braces guarantee.
    const existing = role.permissions instanceof Map
      ? Object.fromEntries(role.permissions)
      : (role.permissions || {});
    const merged = { ...existing };

    for (const [mod, actions] of Object.entries(permissions)) {
      if (!PERMISSION_MODULES.includes(mod)) continue; // silently ignore unknown modules
      const clean = {};
      for (const action of PERMISSION_ACTIONS) {
        clean[action] = !!actions?.[action];
      }
      merged[mod] = clean;
    }

    role.permissions = merged;
    role.markModified('permissions');
    await role.save();

    logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'Role Permissions Updated',
      details: `Updated permissions for role "${role.label}"`,
    });

    res.json(role);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;