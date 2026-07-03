// backend/models/StockMovement.js
import mongoose from 'mongoose';

const stockMovementSchema = new mongoose.Schema({
  type: { type: String, enum: ['restock', 'sale', 'adjustment'], required: true },
  item: { type: String, required: true }, // e.g. 'jollof', 'friedRice', 'spaghettiPlastics', 'lunchBoxes', 'extras:plantain'
  quantity: { type: Number, required: true }, // positive for restock, negative for sale deduction
  reason: { type: String, default: '' },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  performedBy: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('StockMovement', stockMovementSchema);