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
}, { timestamps: true });
export default mongoose.model('MenuItem', menuItemSchema);
