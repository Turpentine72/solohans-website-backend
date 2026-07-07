import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Otp from '../models/Otp.js';
import { sendBrandedEmail, sendPasswordChangeAlertToAdmin } from '../utils/emailTemplates.js'; // ✅ branded emails
import { protect } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();

// ─── Helper: sign JWT ────────────────────────────────────────────────────────
const signToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, name: user.name, role: user.role, tokenVersion: user.tokenVersion },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

// ─── Login ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (user.status === 'Inactive') {
      return res.status(403).json({ message: 'Your account has been deactivated. Please contact the administrator.' });
    }
    let permissions = {};
    if (!user.isSuperAdmin) {
      const role = await Role.findOne({ name: user.role });
      if (role?.permissions) permissions = Object.fromEntries(role.permissions);
    }
    res.json({
      token: signToken(user),
      user: { id: user._id, email: user.email, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin, permissions },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Register (temporary – create first admin) ────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(400).json({ message: 'Email already exists' });

    const user = await User.create({ email, password }); // role defaults to 'admin'
    res.status(201).json({
      message: 'User created',
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Forgot Password (send OTP) ──────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Prevent email enumeration
    if (!user) {
      return res.json({ message: 'If that email exists, an OTP has been sent' });
    }

    // Delete any previous OTPs for this email
    await Otp.deleteMany({ email: user.email });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save OTP to MongoDB (survives server restarts)
    await Otp.create({
      email: user.email,
      otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    });

    // Send branded OTP email (same style as all other emails)
    await sendBrandedEmail({
      to: user.email,
      subject: 'Password Reset OTP',
      content: `
        <h2>Password Reset</h2>
        <p>Use the code below to reset your password. It expires in <strong>10 minutes</strong>.</p>
        <div style="font-size:36px; font-weight:bold; letter-spacing:8px; color:#C62828; text-align:center; padding:20px; background:#FFF8F0; border-radius:8px; margin:20px 0;">
          ${otp}
        </div>
        <p>If you did not request this, please ignore this email.</p>
      `,
    });

    res.json({ message: 'OTP sent' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
  }
});

// ─── Reset Password (verify OTP + set new password) ──────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: 'Email, OTP, and new password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    // Find a valid OTP
    const record = await Otp.findOne({
      email: user.email,
      otp,
      expiresAt: { $gt: new Date() },
    });

    if (!record) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    if (await user.wasPreviouslyUsed(newPassword)) {
      return res.status(400).json({ message: "You've used this password before — please choose a different one." });
    }

    // Update password (pre‑save hook in User model will hash it + track history)
    user.password = newPassword;
    user.tokenVersion += 1; // 🔒 logout all active sessions
    await user.save();

    // Clean up OTPs for this email
    await Otp.deleteMany({ email: user.email });

    // 🔔 Same admin alert + audit trail as the self-service change-password route
    sendPasswordChangeAlertToAdmin({ staffName: user.name, staffEmail: user.email })
      .catch(err => console.error('Password change alert email error:', err));

    logAudit({
      userId: user._id,
      userEmail: user.email,
      action: 'Password Reset (OTP)',
      details: `${user.name || user.email} reset their password via the forgot-password flow`,
    });

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Change Password — Step 1: request (validates + sends OTP) ───────────────
router.post('/change-password/request', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'Current password, new password, and confirmation are all required' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'New password and confirmation do not match' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user.id);
    if (!user || !(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    if (await user.wasPreviouslyUsed(newPassword)) {
      return res.status(400).json({ message: "You've used this password before — please choose a different one." });
    }

    await Otp.deleteMany({ email: user.email, purpose: 'change' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const pendingPasswordHash = await bcrypt.hash(newPassword, 12);

    await Otp.create({
      email: user.email,
      otp,
      purpose: 'change',
      pendingPasswordHash,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes, per spec
    });

    await sendBrandedEmail({
      to: user.email,
      subject: 'Confirm Your Password Change',
      content: `
        <h2>Confirm Password Change</h2>
        <p>Enter this code to confirm your password change. It expires in <strong>5 minutes</strong>.</p>
        <div style="font-size:36px; font-weight:bold; letter-spacing:8px; color:#C62828; text-align:center; padding:20px; background:#FFF8F0; border-radius:8px; margin:20px 0;">
          ${otp}
        </div>
        <p>If you didn't request this, you can safely ignore this email — your password will not be changed.</p>
      `,
    });

    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Change Password — Resend OTP (max 3 resends) ─────────────────────────────
router.post('/change-password/resend', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const record = await Otp.findOne({ email: user.email, purpose: 'change' });
    if (!record) {
      return res.status(400).json({ message: 'No pending password change found — please start again' });
    }
    if (record.resendCount >= 3) {
      return res.status(400).json({ message: 'Maximum resend limit reached — please start the password change again' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    record.otp = otp;
    record.resendCount += 1;
    record.attempts = 0; // fresh code, fresh attempt count
    record.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await record.save();

    await sendBrandedEmail({
      to: user.email,
      subject: 'Confirm Your Password Change',
      content: `
        <h2>Confirm Password Change</h2>
        <p>Here's your new code. It expires in <strong>5 minutes</strong>.</p>
        <div style="font-size:36px; font-weight:bold; letter-spacing:8px; color:#C62828; text-align:center; padding:20px; background:#FFF8F0; border-radius:8px; margin:20px 0;">
          ${otp}
        </div>
      `,
    });

    res.json({ message: 'OTP resent' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Change Password — Step 2: verify OTP and apply the change ───────────────
router.post('/change-password/verify', protect, async (req, res) => {
  try {
    const { otp } = req.body;
    const user = await User.findById(req.user.id);
    const record = await Otp.findOne({ email: user.email, purpose: 'change' });

    if (!record) {
      return res.status(400).json({ message: 'No pending password change found — please start again' });
    }
    if (record.expiresAt < new Date()) {
      await record.deleteOne();
      return res.status(400).json({ message: 'This code has expired — please start again' });
    }
    if (record.attempts >= 3) {
      await record.deleteOne();
      return res.status(400).json({ message: 'Too many incorrect attempts — please start the password change again' });
    }
    if (record.otp !== otp) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ message: `Incorrect code (${3 - record.attempts} attempt(s) left)` });
    }

    // ✅ Correct code — apply the already-hashed pending password directly
    // via findByIdAndUpdate, which bypasses the pre-save hook entirely (it
    // would otherwise try to hash an already-hashed value). We push the
    // CURRENT hash into history ourselves first, then overwrite it.
    const previousHash = user.password;
    user.tokenVersion += 1; // 🔒 logout all active sessions — must log in again

    await User.findByIdAndUpdate(user._id, {
      $set: { password: record.pendingPasswordHash, tokenVersion: user.tokenVersion },
      $push: { passwordHistory: { $each: [previousHash], $position: 0, $slice: 5 } },
    });

    await record.deleteOne();

    // 🔔 Success email to the user themselves (per spec) + admin alert + audit
    sendBrandedEmail({
      to: user.email,
      subject: 'Your Password Was Changed',
      content: `
        <h2>Password Changed Successfully</h2>
        <p>Your password was just changed. You've been logged out of all devices for security — please log in again with your new password.</p>
        <p style="color:#888;">If this wasn't you, contact your admin immediately.</p>
      `,
    }).catch(err => console.error('Password change confirmation email error:', err));

    sendPasswordChangeAlertToAdmin({ staffName: user.name, staffEmail: user.email })
      .catch(err => console.error('Password change alert email error:', err));

    logAudit({
      userId: user._id,
      userEmail: user.email,
      action: 'Password Changed',
      details: `${user.name || user.email} changed their own password (OTP-verified)`,
    });

    res.json({ message: 'Password changed successfully — please log in again' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Lightweight session check — GET /api/auth/me ────────────────────────
// Passing through `protect` is the entire point: it already re-validates
// tokenVersion and status against the live database on every call. The
// frontend polls this periodically so a staff member who is deactivated
// while idle (not clicking anything) still gets logged out within seconds,
// not just on their next incidental API call.
router.get('/me', protect, async (req, res) => {
  try {
    let permissions = {};
    if (!req.user.isSuperAdmin) {
      const role = await Role.findOne({ name: req.user.role });
      if (role?.permissions) {
        permissions = Object.fromEntries(role.permissions);
      }
    }
    res.json({
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      isSuperAdmin: req.user.isSuperAdmin,
      permissions, // ignored entirely by the frontend when isSuperAdmin is true
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;