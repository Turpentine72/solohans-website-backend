// backend/resetAdminPassword.js
//
// Emergency password reset — run manually, never via HTTP.
// Usage: node resetAdminPassword.js user@example.com "NewStrongPassword123!"
//
// ⚠️ SECURITY: this file previously (and two duplicate copies of it) had a
// REAL admin email address and the password "admin123" hardcoded directly
// in source control. If this repo has ever been pushed to GitHub with that
// content, treat that password as compromised — change it immediately via
// the app's normal "Forgot Password" flow, regardless of whether this
// script was ever actually run. Never hardcode real credentials in a
// script that gets committed — always pass them as arguments, like below.

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import User from './models/User.js';

dotenv.config();

const [, , email, newPassword] = process.argv;

if (!email || !newPassword) {
  console.error('Usage: node resetAdminPassword.js <email> <newPassword>');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      console.log(`No user found with email ${email}`);
      process.exit(1);
    }

    user.password = await bcrypt.hash(newPassword, 10);
    // Invalidate any existing login sessions for this account, since the
    // password just changed out from under them — the same behavior the
    // normal in-app password reset flow uses.
    if (typeof user.tokenVersion === 'number') user.tokenVersion += 1;
    await user.save();

    console.log(`✅ Password updated for ${email}. All existing sessions for this account have been signed out.`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

run();