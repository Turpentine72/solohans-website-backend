import mongoose from 'mongoose';

// ✅ Every module that can be permission-gated. Adding a new one later is
// just adding a key here and to MODULES on the frontend — no schema
// migration needed, since permissions is a Map.
export const PERMISSION_MODULES = [
  'dashboard', 'orders', 'pos', 'menu', 'meal_inventory', 'ingredients',
  'staff', 'roles', 'reports', 'payment_verification', 'reconciliation',
  'audit_log', 'settings',
];

export const PERMISSION_ACTIONS = [
  'view', 'create', 'edit', 'delete', 'approve', 'archive', 'export', 'manage', 'print',
];

const modulePermissionSchema = new mongoose.Schema({
  view: { type: Boolean, default: false },
  create: { type: Boolean, default: false },
  edit: { type: Boolean, default: false },
  delete: { type: Boolean, default: false },
  approve: { type: Boolean, default: false },
  archive: { type: Boolean, default: false },
  export: { type: Boolean, default: false },
  manage: { type: Boolean, default: false }, // "manage" implies full control of that module
  print: { type: Boolean, default: false },
}, { _id: false });

const roleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true }, // display name, e.g. "Cashier"
  builtIn: { type: Boolean, default: false }, // built-in roles can't be deleted — they have hardcoded permissions elsewhere in the system
  // ✅ RBAC — per-module permissions. Empty/missing module = no access to
  // that module at all (safe default: deny). Super Admins bypass this
  // entirely (see User.isSuperAdmin) regardless of what their role's
  // permissions say.
  permissions: {
    type: Map,
    of: modulePermissionSchema,
    default: () => ({}),
  },
}, { timestamps: true });

export default mongoose.model('Role', roleSchema);