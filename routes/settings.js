import express from 'express';
import Settings from '../models/Settings.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// ✅ GET settings – public, but strips the Paystack secret key.
// Used by the public site (business info, social links, bank transfer details).
router.get('/', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    const safeSettings = settings.toObject();
    if (safeSettings.payment) {
      delete safeSettings.payment.paystackSecretKey;
    }
    res.json(safeSettings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ GET full settings (includes Paystack secret key) – admin only.
// Used by the admin Settings page to populate the edit form.
router.get('/admin', protect, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ PUT (update) settings – already admin only (unchanged)
router.put('/', protect, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    // Deep merge for social and payment objects
    const { social, payment, ...rest } = req.body;
    if (social) {
      settings.social = { ...settings.social.toObject(), ...social };
    }
    if (payment) {
      settings.payment = { ...settings.payment.toObject(), ...payment };
    }
    Object.assign(settings, rest);

    await settings.save();
    res.json(settings);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;