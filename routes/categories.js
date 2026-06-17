import express from 'express';
import Category from '../models/Category.js';
import { protect } from '../middleware/auth.js';
const router = express.Router();

router.get('/', async (req, res) => {
  try { res.json(await Category.find().sort('name')); }
  catch (err) { res.status(500).json({ message: err.message }); }
});
router.post('/', protect, async (req, res) => {
  try { res.status(201).json(await Category.create(req.body)); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
router.put('/:id', protect, async (req, res) => {
  try { res.json(await Category.findByIdAndUpdate(req.params.id, req.body, { new: true })); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
router.delete('/:id', protect, async (req, res) => {
  try { await Category.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
export default router;
