import express from 'express';
import Gallery from '../models/Gallery.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Public – get only active images
router.get('/', async (req, res) => {
  try {
    const images = await Gallery.find({ active: true }).sort('-createdAt');
    res.json(images);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin – get all images
router.get('/admin', protect, async (req, res) => {
  try {
    const images = await Gallery.find().sort('-createdAt');
    res.json(images);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin – create
router.post('/', protect, async (req, res) => {
  try {
    const { image, caption } = req.body;
    const galleryItem = await Gallery.create({ image, caption });
    res.status(201).json(galleryItem);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Admin – update (toggle active or update caption)
router.patch('/:id', protect, async (req, res) => {
  try {
    const item = await Gallery.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Admin – delete
router.delete('/:id', protect, async (req, res) => {
  try {
    await Gallery.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;