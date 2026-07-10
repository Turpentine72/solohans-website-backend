// backend/models/Inventory.js
import mongoose from 'mongoose';

const portionStockSchema = new mongoose.Schema({
  totalAdded: { type: Number, default: 0 },
  sold: { type: Number, default: 0 },
}, { _id: false });

const extraItemSchema = new mongoose.Schema({
  label: { type: String, required: true },
  price: { type: Number, required: true, default: 0 },
  usesPlastic: { type: Boolean, default: false },
  totalAdded: { type: Number, default: 0 },
  sold: { type: Number, default: 0 },
}, { _id: false });

const inventorySchema = new mongoose.Schema({
  // Singleton key so there is always exactly one shared inventory document
  key: { type: String, default: 'main', unique: true },

  // Rice — tracked in scoops
  jollof: { type: portionStockSchema, default: () => ({}) },
  friedRice: { type: portionStockSchema, default: () => ({}) },

  // Spaghetti — tracked in plastics (2 plastics = 1 complete meal)
  spaghettiPlastics: { type: portionStockSchema, default: () => ({}) },

  // Lunch boxes — 1 deducted per meal package sold
  lunchBoxes: { type: portionStockSchema, default: () => ({}) },

  // Shared small-plastic packaging pool used by plantain / salad / coleslaw
  extraPlastics: { type: portionStockSchema, default: () => ({}) },

  // Standalone extras catalog (hotdog, water, drinks, plantain, salad, coleslaw, ...)
  extras: {
    type: Map,
    of: extraItemSchema,
    default: () => ({
      hotdog: { label: 'Hotdog', price: 1000, usesPlastic: false, totalAdded: 0, sold: 0 },
      water: { label: 'Water', price: 500, usesPlastic: false, totalAdded: 0, sold: 0 },
      drinks: { label: 'Drinks', price: 1000, usesPlastic: false, totalAdded: 0, sold: 0 },
      plantain: { label: 'Plantain', price: 1000, usesPlastic: true, totalAdded: 0, sold: 0 },
      salad: { label: 'Salad', price: 1000, usesPlastic: true, totalAdded: 0, sold: 0 },
      coleslaw: { label: 'Coleslaw', price: 1000, usesPlastic: true, totalAdded: 0, sold: 0 },
    }),
  },

  extraPortionsSold: { type: Number, default: 0 },
  extraPortionsRevenue: { type: Number, default: 0 },

  lowStockThreshold: { type: Number, default: 10 },
}, { timestamps: true });

inventorySchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ key: 'main' });
  if (!doc) doc = await this.create({ key: 'main' });

  // ✅ One-time, idempotent backfill — the schema-level `extras` default
  // above only ever applies to a BRAND NEW document. This business's
  // Inventory document already existed before these new extras were
  // added, so it needs to be patched directly. Every check here is
  // additive-only and never overwrites anything already present, so a
  // Super Admin's manual price changes (e.g. via Meal Inventory) are
  // always preserved.
  let changed = false;
  const NEW_EXTRAS = {
    coleslawSmall: { label: 'Coleslaw Small', price: 1000, usesPlastic: true },
    coleslawBig: { label: 'Coleslaw Big', price: 2000, usesPlastic: true },
    plantainSmall: { label: 'Plantain Small', price: 1000, usesPlastic: true },
    plantainBig: { label: 'Plantain Big', price: 2000, usesPlastic: true },
  };
  for (const [key, defaults] of Object.entries(NEW_EXTRAS)) {
    if (!doc.extras.has(key)) {
      doc.extras.set(key, { ...defaults, totalAdded: 0, sold: 0 });
      changed = true;
    }
  }
  // Hotdog price correction — ONLY if it's still sitting at the old
  // default of ₦1000 (meaning nobody has manually priced it since). If a
  // Super Admin already changed it to something else, that's left alone.
  const hotdog = doc.extras.get('hotdog');
  if (hotdog && hotdog.price === 1000) {
    hotdog.price = 500;
    doc.extras.set('hotdog', hotdog);
    changed = true;
  }
  if (changed) {
    doc.markModified('extras');
    await doc.save();
  }

  return doc;
};

export default mongoose.model('Inventory', inventorySchema);