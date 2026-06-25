import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Otp from '../models/Otp.js';
import { sendBrandedEmail, sendPasswordChangeAlertToAdmin } from '../utils/emailTemplates.js'; // ✅ branded emails
import { protect } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();

// ─── Helper: sign JWT ────────────────────────────────────────────────────────
const signToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, name: user.name, role: user.role },
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
    res.json({
      token: signToken(user),
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
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

    // Update password (pre‑save hook in User model will hash it automatically)
    user.password = newPassword;
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

// ─── Change Password (logged-in staff, self-service) ─────────────────────────
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user || !(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    user.password = newPassword; // pre-save hook hashes it
    await user.save();

    // 🔔 Admin alert + audit trail — never blocks the response if either fails
    sendPasswordChangeAlertToAdmin({ staffName: user.name, staffEmail: user.email })
      .catch(err => console.error('Password change alert email error:', err));

    logAudit({
      userId: user._id,
      userEmail: user.email,
      action: 'Password Changed',
      details: `${user.name || user.email} changed their own password`,
    });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;