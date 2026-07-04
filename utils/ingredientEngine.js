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