// backend/models/StockMovement.js
import mongoose from 'mongoose';

const stockMovementSchema = new mongoose.Schema({
  type: { type: String, enum: ['restock', 'sale', 'adjustment', 'reset'], required: true },
  item: { type: String, required: true }, // e.g. 'jollof', 'friedRice', 'spaghettiPlastics', 'lunchBoxes', 'extras:plantain'
  quantity: { type: Number, required: true }, // positive for restock, negative for sale deduction
  reason: { type: String, default: '' },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  performedBy: { type: String, default: '' },
  // ✅ Reset Stock audit trail — only populated for type: 'reset'.
  previousValue: { type: Number, default: null },
  newValue: { type: Number, default: null },
}, { timestamps: true });

export default mongoose.model('StockMovement', stockMovementSchema);