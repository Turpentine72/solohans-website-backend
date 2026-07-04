// backend/models/Ingredient.js
import mongoose from 'mongoose';

// Each ingredient tracks BOTH packs and pieces, always kept in sync:
// - Admin only ever adds stock in packs.
// - Every sale deducts pieces.
// - Packs are ALWAYS derived from remaining pieces — never edited directly.
const ingredientSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // 'shawarmaBread' | 'hotdog' | future keys
  label: { type: String, required: true },              // 'Shawarma Bread', 'Hotdog'
  piecesPerPack: { type: Number, required: true },      // 8 for bread, 12 for hotdog

  initialPacksAdded: { type: Number, default: 0 },      // lifetime total packs ever added
  initialPieces: { type: Number, default: 0 },          // lifetime total pieces ever added (packs * piecesPerPack)
  piecesUsed: { type: Number, default: 0 },              // lifetime pieces deducted by sales

  lowStockThresholdPieces: { type: Number, default: 16 },
}, { timestamps: true });

// Derived, always computed — never stored directly, so it can never drift
// out of sync with the piece count.
ingredientSchema.methods.remainingPieces = function () {
  return Math.max(0, this.initialPieces - this.piecesUsed);
};
ingredientSchema.methods.remainingPacks = function () {
  return Math.floor(this.remainingPieces() / this.piecesPerPack);
};
ingredientSchema.methods.packsConsumed = function () {
  return Math.floor(this.piecesUsed / this.piecesPerPack);
};

ingredientSchema.methods.toReport = function () {
  return {
    key: this.key,
    label: this.label,
    piecesPerPack: this.piecesPerPack,
    initialPacksAdded: this.initialPacksAdded,
    initialPieces: this.initialPieces,
    piecesUsed: this.piecesUsed,
    packsConsumed: this.packsConsumed(),
    remainingPieces: this.remainingPieces(),
    remainingPacks: this.remainingPacks(),
    lowStock: this.remainingPieces() <= this.lowStockThresholdPieces,
    outOfStock: this.remainingPieces() <= 0,
  };
};

export default mongoose.model('Ingredient', ingredientSchema);