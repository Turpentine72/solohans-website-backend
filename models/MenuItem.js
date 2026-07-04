import mongoose from 'mongoose';
const menuItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, default: 'Uncategorized' },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  price: { type: Number, required: true },
  description: { type: String, default: '' },
  image: { type: String, default: '' },
  available: { type: Boolean, default: true },
  signature: { type: Boolean, default: false },
  // ✅ Daily stock tracking — reset to 0 each day when a day is closed via reconciliation
  openingStock: { type: Number, default: 0 },
  sold: { type: Number, default: 0 },
  remaining: { type: Number, default: 0 },
  // ✅ Optional ingredient linkage — powers the dual-level pack/piece
  // inventory system. Empty/absent for ordinary menu items; only set for
  // items that consume tracked ingredients (e.g. Shawarma variants).
  // Generic form (preferred, works for any future ingredient):
  ingredients: [{
    key: { type: String },       // e.g. 'shawarmaBread', 'hotdog'
    qtyPerUnit: { type: Number }, // pieces consumed per 1 unit of this menu item sold
    _id: false,
  }],
  // Shorthand for the built-in Shawarma variants — if `ingredients` above
  // isn't set, this key is used to look up the fixed deduction table.
  ingredientRecipeKey: { type: String, default: '' },
}, { timestamps: true });
export default mongoose.model('MenuItem', menuItemSchema);