// backend/routes/ingredients.js
import express from 'express';
import { protect, requirePermission } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';
import {
  restockIngredient,
  getIngredientReport,
  listIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient,
  resetIngredientStock,
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
// seeded defaults). ─────────────────────────────────────────────────
router.post('/', requirePermission('ingredients', 'create'), async (req, res) => {
  try {
    const { label, pieceLabel, piecesPerPack, lowStockThresholdPieces, key } = req.body;
    const result = await createIngredient({ label, pieceLabel, piecesPerPack, lowStockThresholdPieces, key });
    logAudit({
      userId: req.user.id, userEmail: req.user.email,
      action: 'Ingredient Created',
      details: `Created "${result.label}" (${result.piecesPerPack} pieces/pack)`,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof IngredientStockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

// ─── PUT edit an ingredient's label/pieceLabel/piecesPerPack/threshold.
// The `key` itself is immutable — recipes reference it. This edits
// LABELING/config only — it can never change remaining stock, by design
// (piecesPerPack changes don't retroactively alter initialPieces/piecesUsed). ─
router.put('/:id', requirePermission('ingredients', 'edit'), async (req, res) => {
  try {
    const { label, pieceLabel, piecesPerPack, lowStockThresholdPieces } = req.body;
    const result = await updateIngredient(req.params.id, { label, pieceLabel, piecesPerPack, lowStockThresholdPieces });
    logAudit({
      userId: req.user.id, userEmail: req.user.email,
      action: 'Ingredient Edited',
      details: `Edited "${result.label}" — piecesPerPack: ${result.piecesPerPack}, low stock threshold: ${result.lowStockThresholdPieces}`,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof IngredientStockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

// ─── POST reset an ingredient's stock to an exact counted value ──────
// Never touches lifetime piecesUsed — only corrects the current count.
router.post('/:id/reset', requirePermission('ingredients', 'manage'), async (req, res) => {
  try {
    const { newRemainingPieces, reason } = req.body;
    const { report, previousRemaining, newRemaining } = await resetIngredientStock(req.params.id, newRemainingPieces);
    logAudit({
      userId: req.user.id, userEmail: req.user.email,
      action: 'Ingredient Stock Reset',
      details: `Reset "${report.label}" from ${previousRemaining} to ${newRemaining} pieces${reason ? ` — ${reason}` : ''}`,
    });
    res.json(report);
  } catch (err) {
    if (err instanceof IngredientStockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

// ─── DELETE an ingredient — Super Admin only ─────────────────────────
// Blocked if any menu item's recipe still references it, so a live
// recipe can never silently break. Restricted to Super Admin
// specifically (not just anyone with ingredients:delete permission),
// since deleting an inventory record permanently destroys its history.
router.delete('/:id', (req, res, next) => {
  if (!req.user?.isSuperAdmin) {
    return res.status(403).json({ message: 'Only a Super Admin can permanently delete an ingredient.' });
  }
  next();
}, async (req, res) => {
  try {
    const result = await deleteIngredient(req.params.id);
    logAudit({
      userId: req.user.id, userEmail: req.user.email,
      action: 'Ingredient Deleted',
      details: `Permanently deleted ingredient "${result.key}"`,
    });
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
    logAudit({
      userId: req.user.id, userEmail: req.user.email,
      action: 'Ingredient Restocked',
      details: `Added ${packs} pack(s) to "${result.label}"`,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof IngredientStockError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

export default router;