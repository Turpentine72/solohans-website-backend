import mongoose from 'mongoose';

// ✅ Every module that can be permission-gated. Adding a new one later is
// just adding a key here and to MODULE_META on the frontend — no schema
// migration needed, since permissions is a Map.
//
// This list was previously missing more than half of the app's real pages
// (expenses, promotions, gallery, categories, customers, contacts, reviews,
// backup, payouts, staff history, kitchen, delivery, ...) — meaning those
// pages had NO permission enforcement at all, front or back end. That's the
// loophole this rebuild closes.
export const PERMISSION_MODULES = [
  'dashboard', 'orders', 'pos', 'payment_verification',
  'menu', 'categories', 'meal_inventory', 'ingredients', 'daily_stock',
  'customers', 'contacts', 'reviews', 'notifications', 'promotions', 'gallery',
  'delivery_zones', 'expenses',
  'reconciliation', 'payment_reconciliation',
  'staff', 'roles', 'staff_history', 'kitchen', 'delivery',
  'audit_log', 'settings', 'reports',
  // Deliberately NOT here: 'payouts', 'backup'. Those two are hardcoded
  // Super-Admin-only on every route (frontend and backend) specifically
  // because they can move real money or destroy the entire database —
  // they are never delegatable through this permission system, so they
  // don't belong in the grantable module list (a checkbox here would
  // silently do nothing).
];

export const PERMISSION_ACTIONS = [
  'view', 'create', 'edit', 'delete', 'approve', 'archive', 'export', 'manage', 'print',
];

// ✅ Sensible starter permissions per built-in role — applied only once,
// the first time that role is ever seeded. A Super Admin can change every
// bit of this afterward; this just prevents a brand-new role from being
// unable to do its own job until someone remembers to configure it by
// hand, which in practice is how RBAC rollouts silently get abandoned.
export const DEFAULT_ROLE_PRESETS = {
  cashier: {
    dashboard: ['view'],
    pos: ['view', 'create', 'print'],
    orders: ['view', 'edit'],
    menu: ['view'],
    customers: ['view'],
    daily_stock: ['view'],
    payment_reconciliation: ['view', 'create'],
  },
  storekeeper: {
    dashboard: ['view'],
    pos: ['view', 'create', 'print'],
    meal_inventory: ['view', 'edit', 'manage'],
    ingredients: ['view', 'create', 'edit', 'manage'],
    daily_stock: ['view', 'edit', 'manage'],
    menu: ['view'],
    payment_reconciliation: ['view', 'create'],
  },
  closing_staff: {
    reconciliation: ['view', 'create'],
    payment_reconciliation: ['view', 'create'],
    expenses: ['view', 'create', 'edit'],
    reports: ['view'],
  },
  chef: {
    kitchen: ['view', 'manage'],
    orders: ['view', 'edit'],
    menu: ['view'],
  },
  delivery_staff: {
    delivery: ['view', 'manage'],
    orders: ['view', 'edit'],
  },
};

function presetToPermissions(preset = {}) {
  const perms = {};
  for (const [mod, actions] of Object.entries(preset)) {
    perms[mod] = Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a, actions.includes(a)]));
  }
  return perms;
}
export function defaultPermissionsFor(roleName) {
  return presetToPermissions(DEFAULT_ROLE_PRESETS[roleName]);
}

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