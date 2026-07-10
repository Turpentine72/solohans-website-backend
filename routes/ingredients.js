// backend/routes/ingredients.js
import express from 'express';
import { protect, requireRole, requirePermission } from '../middleware/auth.js';
import {
  restockIngredient,
  getIngredientReport,
  listIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient,
  IngredientStockError,
} from '../utils/ingredientEngine.js';

const router = express.Router();
router.use(protect, requirePermission('ingredients', 'view'));

// ─── GET real-time ingredient consumption report ──────────────────
router.get('/report', async (req, res) => {
  try {
    const report = await getIngredientReport();
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── GET plain list — used by the Menu Management recipe builder to
// populate the "pick an ingredient" dropdown. Same shape as /report. ──
router.get('/', async (req, res) => {
  try {
    const list = await listIngredients();
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST create a brand new ingredient (any name, not just the two
// seeded defaults). Admin/storekeeper only. ────────────────────────
router.post('/', requirePermission('ingredients', 'create'), async (req, res) => {
  try {
    const { label, pieceLabel, piecesPerPack, lowStockThresholdPieces, key } = req.body;
    const result = await createIngredient({ label, pieceLabel, piecesPerPack, lowStockThresholdPieces, key });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof IngredientStockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

// ─── PUT edit an ingredient's label/pieceLabel/piecesPerPack/threshold.
// The `key` itself is immutable — recipes reference it. ────────────
router.put('/:id', requirePermission('ingredients', 'edit'), async (req, res) => {
  try {
    const { label, pieceLabel, piecesPerPack, lowStockThresholdPieces } = req.body;
    const result = await updateIngredient(req.params.id, { label, pieceLabel, piecesPerPack, lowStockThresholdPieces });
    res.json(result);
  } catch (err) {
    if (err instanceof IngredientStockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

// ─── DELETE an ingredient — blocked if any menu item's recipe still
// references it, so a live recipe can never silently break. ───────
router.delete('/:id', requirePermission('ingredients', 'delete'), async (req, res) => {
  try {
    const result = await deleteIngredient(req.params.id);
    res.json({ message: 'Ingredient deleted.', ...result });
  } catch (err) {
    if (err instanceof IngredientStockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

// ─── POST restock an ingredient — PACKS ONLY, never pieces directly ──
// body: { key: 'shawarmaBread' | 'hotdog' | any custom key, packs: 6 }
router.post('/restock', requirePermission('ingredients', 'manage'), async (req, res) => {
  try {
    const { key, packs } = req.body;
    const performedBy = req.user?.email || 'admin';
    const result = await restockIngredient(key, packs, { performedBy });
    res.json(result);
  } catch (err) {
    if (err instanceof IngredientStockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

export default router;