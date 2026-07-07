import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
const userSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: {
    type: String,
    default: 'admin',
    // ✅ No longer a strict enum — admin can create custom roles via the
    // Roles system (see models/Role.js). Validity is checked against the
    // Role collection in routes/staff.js when a staff account is created
    // or its role is changed.
  },
  passwordHistory: { type: [String], default: [] }, // last few hashed passwords — prevents reuse
  tokenVersion: { type: Number, default: 0 }, // bump on password change to invalidate old JWTs ("logout all sessions")
  fcmTokens: { type: [String], default: [] }, // browser push notification tokens
  // ✅ Deactivating a staff account blocks login without deleting their
  // history — sales, shifts, and audit logs stay intact either way.
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  // ✅ RBAC — Super Admin bypasses every permission check, always,
  // regardless of what their assigned role's permissions say. This is
  // deliberately separate from `role` (a string like "admin"), since a
  // role named "admin" is just an ordinary configurable role like any
  // other under the new permission system — only this flag is unrestricted.
  isSuperAdmin: { type: Boolean, default: false },
}, { timestamps: true });
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  // Keep the last 5 hashed passwords so we can block reuse going forward.
  if (!this.isNew && this.password) {
    // `this.password` here is still the OLD plain value being replaced —
    // but bcrypt comparison needs the hash, so we push the CURRENT (pre-hash)
    // doc's stored hash, fetched fresh, into history before overwriting.
    const existing = await this.constructor.findById(this._id).select('password').lean();
    if (existing?.password) {
      this.passwordHistory = [existing.password, ...(this.passwordHistory || [])].slice(0, 5);
    }
  }
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};
userSchema.methods.wasPreviouslyUsed = async function (plain) {
  for (const oldHash of this.passwordHistory || []) {
    if (await bcrypt.compare(plain, oldHash)) return true;
  }
  return false;
};
export default mongoose.model('User', userSchema);