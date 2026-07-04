// backend/routes/ingredients.js
import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { restockIngredient, getIngredientReport, IngredientStockError } from '../utils/ingredientEngine.js';

const router = express.Router();
router.use(protect, requireRole('admin', 'storekeeper', 'cashier'));

// ─── GET real-time ingredient consumption report ──────────────────
// Returns, per ingredient: Initial Packs Added, Initial Pieces, Pieces
// Used, Packs Consumed, Remaining Pieces, Remaining Packs.
router.get('/report', async (req, res) => {
  try {
    const report = await getIngredientReport();
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST restock an ingredient — PACKS ONLY, never pieces directly ──
// body: { key: 'shawarmaBread' | 'hotdog', packs: 6 }
router.post('/restock', requireRole('admin', 'storekeeper'), async (req, res) => {
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