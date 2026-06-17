import mongoose from 'mongoose';

const promoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  type: {
    type: String,
    enum: ['percentage', 'buyXgetY', 'freeItem', 'freeDelivery'],
    required: true
  },
  // Percentage discount
  discountPercentage: { type: Number, default: null },
  // Buy X Get Y
  buyQuantity: { type: Number, default: null },
  getQuantity: { type: Number, default: null },
  // Free item – now supports multiple trigger items
  triggerItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' }],
  freeItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', default: null },
  // Scope
  scope: { type: String, enum: ['all', 'selected'], default: 'all' },
  applicableItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' }],
  // Dates
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('Promo', promoSchema);