import express from 'express';
import User from '../models/User.js';
import Otp from '../models/Otp.js';                      // ✅ DB-backed OTP
import { protect } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import { sendBrandedEmail } from '../utils/emailTemplates.js';  // ✅ branded emails

const router = express.Router();

// ─── Send OTP to admin's email ──────────────────────────────────────────────
router.post('/send-otp', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Delete previous OTP for this email
    await Otp.deleteMany({ email: user.email });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await Otp.create({
      email: user.email,
      otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    });

    // Send branded OTP email (same style as all other emails)
    await sendBrandedEmail({
      to: user.email,
      subject: 'Your OTP Code',
      content: `
        <h2>One-Time Password</h2>
        <p>Use the code below to verify your identity. It expires in <strong>10 minutes</strong>.</p>
        <div style="font-size:36px; font-weight:bold; letter-spacing:8px; color:#C62828; text-align:center; padding:20px; background:#FFF8F0; border-radius:8px; margin:20px 0;">
          ${otp}
        </div>
        <p>If you did not request this, please ignore this email.</p>
      `,
    });

    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error('OTP send error:', err);
    res.status(500).json({
      message: process.env.NODE_ENV === 'development' ? err.message : 'Failed to send OTP',
    });
  }
});

// ─── Change email ────────────────────────────────────────────────────────────
router.post('/change-email', protect, async (req, res) => {
  try {
    const { newEmail, otp } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Check OTP from database
    const record = await Otp.findOne({
      email: user.email,
      otp,
      expiresAt: { $gt: new Date() },
    });
    if (!record) return res.status(400).json({ message: 'Invalid or expired OTP' });

    const oldEmail = user.email;
    user.email = newEmail.toLowerCase().trim();
    await user.save();

    // Clean up OTPs for both old and new emails
    await Otp.deleteMany({ email: { $in: [oldEmail, newEmail] } });

    res.json({ message: 'Email updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Change password ─────────────────────────────────────────────────────────
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword, otp } = req.body;
    if (!currentPassword || !newPassword || !otp) {
      return res.status(400).json({ message: 'Current password, new password, and OTP are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Current password is incorrect' });

    // Check OTP from database
    const record = await Otp.findOne({
      email: user.email,
      otp,
      expiresAt: { $gt: new Date() },
    });
    if (!record) return res.status(400).json({ message: 'Invalid or expired OTP' });

    // Update password – the pre‑save hook in User.js will hash it automatically
    user.password = newPassword;
    await user.save();

    // Remove used OTP
    await Otp.deleteMany({ email: user.email });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Verify admin password (for unlocking payment keys) ──────────────────────
router.post('/verify-password', protect, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'Password is required' });

    const user = await User.findById(req.user.id).select('+password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Incorrect password' });

    res.json({ verified: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;