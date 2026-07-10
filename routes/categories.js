import express from 'express';
import Category from '../models/Category.js';
import { protect, requirePermission } from '../middleware/auth.js';
const router = express.Router();

router.get('/', async (req, res) => {
  try { res.json(await Category.find().sort('name')); }
  catch (err) { res.status(500).json({ message: err.message }); }
});
router.post('/', protect, requirePermission('categories', 'create'), async (req, res) => {
  try { res.status(201).json(await Category.create(req.body)); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
router.put('/:id', protect, requirePermission('categories', 'edit'), async (req, res) => {
  try { res.json(await Category.findByIdAndUpdate(req.params.id, req.body, { new: true })); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
router.delete('/:id', protect, requirePermission('categories', 'delete'), async (req, res) => {
  try { await Category.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (err) { res.status(400).json({ message: err.message }); }
});
export default router;