import express from 'express';
import DeliveryZone from '../models/DeliveryZone.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Public – active zones only, for the checkout dropdown
router.get('/active', async (req, res) => {
  try {
    const zones = await DeliveryZone.find({ active: true }).sort('name');
    res.json(zones);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin – all zones (including inactive)
router.get('/', protect, async (req, res) => {
  try {
    const zones = await DeliveryZone.find().sort('name');
    res.json(zones);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin – create
router.post('/', protect, async (req, res) => {
  try {
    const zone = await DeliveryZone.create(req.body);
    res.status(201).json(zone);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Admin – update
router.put('/:id', protect, async (req, res) => {
  try {
    const zone = await DeliveryZone.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!zone) return res.status(404).json({ message: 'Zone not found' });
    res.json(zone);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Admin – toggle active
router.patch('/:id/toggle', protect, async (req, res) => {
  try {
    const zone = await DeliveryZone.findById(req.params.id);
    if (!zone) return res.status(404).json({ message: 'Zone not found' });
    zone.active = !zone.active;
    await zone.save();
    res.json(zone);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Admin – delete
router.delete('/:id', protect, async (req, res) => {
  try {
    await DeliveryZone.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
