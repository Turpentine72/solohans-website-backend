// backend/routes/inventory.js
import express from 'express';
import { protect, requirePermission } from '../middleware/auth.js';
import Inventory from '../models/Inventory.js';
import StockMovement from '../models/StockMovement.js';
import { restock, resetStock, deleteExtra, inventorySnapshot, StockError } from '../utils/stockEngine.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();
router.use(protect, requirePermission('meal_inventory', 'view'));

// ─── GET current inventory snapshot ─────────────────────────────
router.get('/', async (req, res) => {
  try {
    const inv = await Inventory.getSingleton();
    res.json(inventorySnapshot(inv));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PATCH low stock threshold ───────────────────────────────────
router.patch('/threshold', requirePermission('meal_inventory', 'manage'), async (req, res) => {
  try {
    const inv = await Inventory.getSingleton();
    const previous = inv.lowStockThreshold;
    inv.lowStockThreshold = Number(req.body.lowStockThreshold) || inv.lowStockThreshold;
    await inv.save();
    logAudit({
      userId: req.user.id, userEmail: req.user.email,
      action: 'Low Stock Threshold Changed',
      details: `Changed from ${previous} to ${inv.lowStockThreshold}`,
    });
    res.json(inventorySnapshot(inv));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── POST restock an item ────────────────────────────────────────
// body: { item: 'jollof' | 'friedRice' | 'spaghettiPlastics' | 'lunchBoxes' | 'extraPlastics' | 'extras:plantain', quantity, reason }
router.post('/restock', requirePermission('meal_inventory', 'manage'), async (req, res) => {
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
router.patch('/extras/:key', requirePermission('meal_inventory', 'edit'), async (req, res) => {
  try {
    const inv = await Inventory.getSingleton();
    const entry = inv.extras.get(req.params.key);
    if (!entry) return res.status(404).json({ message: 'Extra item not found' });
    const previousPrice = entry.price;
    if (req.body.price !== undefined) entry.price = Number(req.body.price);
    if (req.body.label !== undefined) entry.label = req.body.label;
    inv.extras.set(req.params.key, entry);
    await inv.save();
    logAudit({
      userId: req.user.id, userEmail: req.user.email,
      action: 'Extra Item Edited',
      details: `Edited "${entry.label}"${req.body.price !== undefined ? ` — price: ₦${previousPrice} → ₦${entry.price}` : ''}`,
    });
    res.json(inventorySnapshot(inv));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── POST create a new extra item type ───────────────────────────
router.post('/extras', requirePermission('meal_inventory', 'create'), async (req, res) => {
  try {
    const { key, label, price, usesPlastic } = req.body;
    if (!key || !label) return res.status(400).json({ message: 'key and label are required' });
    const inv = await Inventory.getSingleton();
    if (inv.extras.get(key)) return res.status(400).json({ message: 'Extra item already exists' });
    inv.extras.set(key, { label, price: Number(price) || 0, usesPlastic: !!usesPlastic, totalAdded: 0, sold: 0 });
    await inv.save();
    logAudit({
      userId: req.user.id, userEmail: req.user.email,
      action: 'Extra Item Created',
      details: `Created "${label}" at ₦${Number(price) || 0}`,
    });
    res.status(201).json(inventorySnapshot(inv));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── POST reset an item's stock to an exact counted value ────────
// body: { item, newRemaining, reason }. Never touches lifetime 'sold'
// history — only corrects the current remaining count.
router.post('/reset', requirePermission('meal_inventory', 'manage'), async (req, res) => {
  try {
    const { item, newRemaining, reason } = req.body;
    const performedBy = req.user?.email || req.user?.id || 'admin';
    const inv = await resetStock(item, newRemaining, { reason, performedBy });
    logAudit({
      userId: req.user.id, userEmail: req.user.email,
      action: 'Stock Reset',
      details: `Reset "${item}" to ${newRemaining}${reason ? ` — ${reason}` : ''}`,
    });
    res.json(inventorySnapshot(inv));
  } catch (err) {
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

// ─── DELETE an extra item type — Super Admin only ─────────────────
// Deletion of any inventory record is restricted to Super Admin
// specifically (not just anyone with meal_inventory:delete), since it's
// permanent and the item must already be reset to 0 stock first.
router.delete('/extras/:key', (req, res, next) => {
  if (!req.user?.isSuperAdmin) {
    return res.status(403).json({ message: 'Only a Super Admin can permanently delete an inventory item.' });
  }
  next();
}, async (req, res) => {
  try {
    const performedBy = req.user?.email || 'admin';
    await deleteExtra(req.params.key, { reason: req.body?.reason, performedBy });
    logAudit({
      userId: req.user.id, userEmail: req.user.email,
      action: 'Extra Item Deleted',
      details: `Permanently deleted extra item "${req.params.key}"`,
    });
    const inv = await Inventory.getSingleton();
    res.json(inventorySnapshot(inv));
  } catch (err) {
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

// ─── GET stock movement history ──────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const movements = await StockMovement.find().sort({ createdAt: -1 }).limit(limit);
    res.json(movements);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;