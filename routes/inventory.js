// backend/routes/inventory.js
import express from 'express';
import { protect } from '../middleware/auth.js';
import Inventory from '../models/Inventory.js';
import StockMovement from '../models/StockMovement.js';
import { restock, inventorySnapshot, StockError } from '../utils/stockEngine.js';

const router = express.Router();

// ─── GET current inventory snapshot ─────────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    const inv = await Inventory.getSingleton();
    res.json(inventorySnapshot(inv));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PATCH low stock threshold ───────────────────────────────────
router.patch('/threshold', protect, async (req, res) => {
  try {
    const inv = await Inventory.getSingleton();
    inv.lowStockThreshold = Number(req.body.lowStockThreshold) || inv.lowStockThreshold;
    await inv.save();
    res.json(inventorySnapshot(inv));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── POST restock an item ────────────────────────────────────────
// body: { item: 'jollof' | 'friedRice' | 'spaghettiPlastics' | 'lunchBoxes' | 'extraPlastics' | 'extras:plantain', quantity, reason }
router.post('/restock', protect, async (req, res) => {
  try {
    const { item, quantity, reason } = req.body;
    const performedBy = req.user?.email || req.user?.id || 'admin';
    const inv = await restock(item, quantity, { reason, performedBy });
    res.json(inventorySnapshot(inv));
  } catch (err) {
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

// ─── PATCH update an extra item's price/label ───────────────────
router.patch('/extras/:key', protect, async (req, res) => {
  try {
    const inv = await Inventory.getSingleton();
    const entry = inv.extras.get(req.params.key);
    if (!entry) return res.status(404).json({ message: 'Extra item not found' });
    if (req.body.price !== undefined) entry.price = Number(req.body.price);
    if (req.body.label !== undefined) entry.label = req.body.label;
    inv.extras.set(req.params.key, entry);
    await inv.save();
    res.json(inventorySnapshot(inv));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── POST create a new extra item type ───────────────────────────
router.post('/extras', protect, async (req, res) => {
  try {
    const { key, label, price, usesPlastic } = req.body;
    if (!key || !label) return res.status(400).json({ message: 'key and label are required' });
    const inv = await Inventory.getSingleton();
    if (inv.extras.get(key)) return res.status(400).json({ message: 'Extra item already exists' });
    inv.extras.set(key, { label, price: Number(price) || 0, usesPlastic: !!usesPlastic, totalAdded: 0, sold: 0 });
    await inv.save();
    res.status(201).json(inventorySnapshot(inv));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── GET stock movement history ──────────────────────────────────
router.get('/history', protect, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const movements = await StockMovement.find().sort({ createdAt: -1 }).limit(limit);
    res.json(movements);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;