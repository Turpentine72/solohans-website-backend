import express from 'express';
import MenuItem from '../models/MenuItem.js';
import Category from '../models/Category.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const query = {};
    if (req.query.available !== undefined) query.available = req.query.available === 'true';
    if (req.query.signature !== undefined) query.signature = req.query.signature === 'true';
    let q = MenuItem.find(query).sort({ createdAt: -1 });
    if (req.query.limit) q = q.limit(Number(req.query.limit));
    res.json(await q);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    // Resolve category name from category_id if provided
    if (req.body.category_id) {
      const cat = await Category.findById(req.body.category_id);
      if (cat) req.body.category = cat.name;
    }
    const newItem = await MenuItem.create(req.body);
    res.status(201).json(newItem);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put('/:id', protect, async (req, res) => {
  try {
    if (req.body.category_id) {
      const cat = await Category.findById(req.body.category_id);
      if (cat) req.body.category = cat.name;
    }
    const updated = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    await MenuItem.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;