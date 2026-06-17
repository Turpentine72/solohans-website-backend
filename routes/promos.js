import express from 'express';
import Promo from '../models/Promo.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Public – get only active, non‑expired promos
router.get('/active', async (req, res) => {
  const now = new Date();
  // Auto-deactivate expired promos in the background
  await Promo.updateMany({ endDate: { $lt: now }, active: true }, { active: false });
  const promos = await Promo.find({
    active: true,
    startDate: { $lte: now },
    endDate: { $gte: now }
  }).populate('triggerItems freeItem applicableItems');
  res.json(promos);
});

// Admin – get all promos
router.get('/', protect, async (req, res) => {
  const promos = await Promo.find()
    .populate('triggerItems freeItem applicableItems')
    .sort('-createdAt');
  res.json(promos);
});

// Create
router.post('/', protect, async (req, res) => {
  try {
    const promo = await Promo.create(req.body);
    res.status(201).json(promo);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update
router.put('/:id', protect, async (req, res) => {
  try {
    const promo = await Promo.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(promo);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Toggle active
router.patch('/:id/toggle', protect, async (req, res) => {
  const promo = await Promo.findById(req.params.id);
  promo.active = !promo.active;
  await promo.save();
  res.json(promo);
});

// Delete
router.delete('/:id', protect, async (req, res) => {
  await Promo.findByIdAndDelete(req.params.id);
  res.json({ message: 'Deleted' });
});

export default router;