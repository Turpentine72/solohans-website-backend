import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Otp from '../models/Otp.js';
import { sendBrandedEmail } from '../utils/emailTemplates.js'; // ✅ branded emails

const router = express.Router();

// ─── Helper: sign JWT ────────────────────────────────────────────────────────
const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// ─── Login ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    res.json({
      token: signToken(user._id),
      user: { id: user._id, email: user.email, role: user.role },
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

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;