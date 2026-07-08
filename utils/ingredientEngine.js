// backend/utils/ingredientEngine.js
import Ingredient from '../models/Ingredient.js';

export class IngredientStockError extends Error {}

// Seeds the two known ingredients on first use — safe to call repeatedly.
export async function ensureSeedIngredients() {
  const defaults = [
    { key: 'shawarmaBread', label: 'Shawarma Bread', pieceLabel: 'Shawarma Wrap', piecesPerPack: 8 },
    { key: 'hotdog', label: 'Hotdog', pieceLabel: 'Hotdog', piecesPerPack: 12 },
  ];
  for (const d of defaults) {
    await Ingredient.findOneAndUpdate(
      { key: d.key },
      { $setOnInsert: d },
      { upsert: true, new: true }
    );
  }
}

// Admin adds stock in PACKS ONLY — pieces and lifetime totals are derived
// automatically. Packs are never edited directly, anywhere, by anyone.
export async function restockIngredient(key, packsToAdd, { performedBy = '' } = {}) {
  const packs = Number(packsToAdd);
  if (!packs || packs <= 0) throw new IngredientStockError('Number of packs must be a positive number.');

  await ensureSeedIngredients();
  const ingredient = await Ingredient.findOne({ key });
  if (!ingredient) throw new IngredientStockError(`Unknown ingredient: ${key}`);

  ingredient.initialPacksAdded += packs;
  ingredient.initialPieces += packs * ingredient.piecesPerPack;
  await ingredient.save();
  return ingredient.toReport();
}

// The exact deduction rules from the spec — the ONLY place these numbers
// live, so every sales channel (POS, website, future channels) stays
// consistent by construction.
const SHAWARMA_VARIANT_DEDUCTIONS = {
  // menu item "key" -> pieces required
  shawarma_single: { shawarmaBread: 1, hotdog: 1 },   // ₦3,500 — Single Sausage
  shawarma_double: { shawarmaBread: 1, hotdog: 2 },   // ₦4,500 — Double Sausage
  shawarma_triple: { shawarmaBread: 1, hotdog: 3 },   // ₦5,500 — Triple Sausage
};

/**
 * Resolves how many ingredient pieces a single cart line item requires.
 * Priority:
 *   1. An explicit `ingredients` mapping on the MenuItem document itself
 *      (admin-configurable, works for ANY future ingredient-linked item).
 *   2. The hardcoded Shawarma variant table above, matched by MenuItem
 *      `ingredientRecipeKey` (falls back to name-based matching for
 *      convenience if that field isn't set yet).
 * Returns {} (no ingredients required) for ordinary, non-ingredient items.
 */
export function resolveIngredientNeeds(menuItem) {
  if (Array.isArray(menuItem?.ingredients) && menuItem.ingredients.length > 0) {
    const needs = {};
    menuItem.ingredients.forEach(({ key, qtyPerUnit }) => {
      if (key && qtyPerUnit) needs[key] = (needs[key] || 0) + Number(qtyPerUnit);
    });
    return needs;
  }

  const recipeKey = menuItem?.ingredientRecipeKey
    || (/single/i.test(menuItem?.name || '') && /shawarma/i.test(menuItem?.name || '') ? 'shawarma_single' : null)
    || (/double/i.test(menuItem?.name || '') && /shawarma/i.test(menuItem?.name || '') ? 'shawarma_double' : null)
    || (/triple/i.test(menuItem?.name || '') && /shawarma/i.test(menuItem?.name || '') ? 'shawarma_triple' : null);

  return SHAWARMA_VARIANT_DEDUCTIONS[recipeKey] || {};
}

/**
 * Given cart line items already resolved to MenuItem documents
 * (item = { menuItem, quantity }), computes total ingredient pieces needed
 * and validates against remaining stock WITHOUT mutating anything.
 * Throws IngredientStockError with the exact message shape from the spec
 * if anything is short.
 */
export async function assertIngredientsAvailable(resolvedItems) {
  const totalNeeded = {}; // key -> pieces
  for (const { menuItem, quantity } of resolvedItems) {
    const needs = resolveIngredientNeeds(menuItem);
    for (const [key, perUnit] of Object.entries(needs)) {
      totalNeeded[key] = (totalNeeded[key] || 0) + perUnit * quantity;
    }
  }

  if (Object.keys(totalNeeded).length === 0) return totalNeeded; // nothing ingredient-linked in this order

  await ensureSeedIngredients();
  const ingredients = await Ingredient.find({ key: { $in: Object.keys(totalNeeded) } });
  const byKey = Object.fromEntries(ingredients.map((i) => [i.key, i]));

  for (const [key, needed] of Object.entries(totalNeeded)) {
    const ingredient = byKey[key];
    const remaining = ingredient ? ingredient.remainingPieces() : 0;
    if (needed > remaining) {
      // Matches the spec exactly: "Insufficient Shawarma Wrap Stock." /
      // "Insufficient Hotdog Stock." — piece-level wording, not the pack label.
      throw new IngredientStockError(`Insufficient ${ingredient?.pieceLabel || ingredient?.label || key} Stock.`);
    }
  }

  return totalNeeded;
}

/**
 * Validates AND deducts. Call this at the moment a sale is actually
 * committed — POS checkout, website order creation, or any future channel.
 * Never silently skips: throws if stock is insufficient, blocking checkout
 * exactly as specified.
 */
export async function deductIngredientsForOrder(resolvedItems, { orderId, performedBy = '' } = {}) {
  const totalNeeded = await assertIngredientsAvailable(resolvedItems);
  if (Object.keys(totalNeeded).length === 0) return totalNeeded;

  for (const [key, pieces] of Object.entries(totalNeeded)) {
    await Ingredient.updateOne({ key }, { $inc: { piecesUsed: pieces } });
  }
  return totalNeeded;
}

export async function getIngredientReport() {
  await ensureSeedIngredients();
  const ingredients = await Ingredient.find().sort('label');
  return ingredients.map((i) => i.toReport());
}

// ─── Generalized CRUD — lets an admin define ANY ingredient, not just the
// two seeded ones. Existing seeded ingredients (shawarmaBread, hotdog) keep
// working exactly as before; this is purely additive. ────────────────────

function slugifyKey(label) {
  return String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

export async function createIngredient({ label, pieceLabel, piecesPerPack, lowStockThresholdPieces, key }) {
  if (!label?.trim()) throw new IngredientStockError('Ingredient name is required.');
  if (!pieceLabel?.trim()) throw new IngredientStockError('Piece label is required (used in low-stock messages).');
  const packs = Number(piecesPerPack);
  if (!packs || packs <= 0) throw new IngredientStockError('Pieces per pack must be a positive number.');

  const resolvedKey = (key?.trim() || slugifyKey(label)) || `ingredient${Date.now()}`;
  const existing = await Ingredient.findOne({ key: resolvedKey });
  if (existing) throw new IngredientStockError(`An ingredient with key "${resolvedKey}" already exists.`);

  const ingredient = await Ingredient.create({
    key: resolvedKey,
    label: label.trim(),
    pieceLabel: pieceLabel.trim(),
    piecesPerPack: packs,
    lowStockThresholdPieces: Number(lowStockThresholdPieces) > 0 ? Number(lowStockThresholdPieces) : 16,
  });
  return ingredient.toReport();
}

export async function updateIngredient(id, { label, pieceLabel, piecesPerPack, lowStockThresholdPieces }) {
  const ingredient = await Ingredient.findById(id);
  if (!ingredient) throw new IngredientStockError('Ingredient not found.');

  // key is intentionally immutable after creation — MenuItem recipes and the
  // hardcoded Shawarma fallback table both reference it, so changing it
  // silently would break existing recipes.
  if (label?.trim()) ingredient.label = label.trim();
  if (pieceLabel?.trim()) ingredient.pieceLabel = pieceLabel.trim();
  if (piecesPerPack !== undefined) {
    const packs = Number(piecesPerPack);
    if (!packs || packs <= 0) throw new IngredientStockError('Pieces per pack must be a positive number.');
    ingredient.piecesPerPack = packs;
  }
  if (lowStockThresholdPieces !== undefined) {
    ingredient.lowStockThresholdPieces = Math.max(0, Number(lowStockThresholdPieces) || 0);
  }
  await ingredient.save();
  return ingredient.toReport();
}

export async function deleteIngredient(id) {
  const MenuItem = (await import('../models/MenuItem.js')).default;
  const ingredient = await Ingredient.findById(id);
  if (!ingredient) throw new IngredientStockError('Ingredient not found.');

  const inUse = await MenuItem.findOne({ 'ingredients.key': ingredient.key });
  if (inUse) {
    throw new IngredientStockError(
      `Can't delete "${ingredient.label}" — it's used in the recipe for "${inUse.name}". Remove it from that recipe first.`
    );
  }

  await Ingredient.deleteOne({ _id: id });
  return { key: ingredient.key };
}

export async function listIngredients() {
  await ensureSeedIngredients();
  const list = await Ingredient.find().sort('label');
  return list.map((i) => i.toReport());
}