import express from 'express';
import Settings from '../models/Settings.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// ✅ GET settings – now protected (admin only)
router.get('/', protect, async (req, res) => {
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