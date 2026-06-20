import mongoose from 'mongoose';
import Counter from './Counter.js';                     // ✅ import counter

const orderSchema = new mongoose.Schema({
  customerEmail: { type: String, required: true },
  customerName: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  items: { type: Array, required: true },
  delivery_method: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
  items_subtotal: { type: Number, default: 0 },   // items only, never includes delivery fee
  totalAmount: { type: Number, required: true },      // final payable amount (items + delivery fee once set)
  delivery_fee: { type: Number, default: null },       // null = not yet set by admin
  delivery_fee_set: { type: Boolean, default: false }, // true once admin sets it (or immediately for pickup)
  status: { type: String, default: 'Pending' },
  payment_status: { type: String, default: 'unpaid' },
  paymentRef: { type: String, default: '' },
  order_type: { type: String, default: 'card' },
  freeDelivery: { type: Boolean, default: false },
  statusHistory: { type: Array, default: [] },
  order_id: { type: String, unique: true },            // will be auto‑generated
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

// ✅ Auto‑generate order_id before saving (if not already set)
orderSchema.pre('save', async function (next) {
  // Backfill items_subtotal for orders created before this field existed —
  // for those orders, totalAmount WAS the items-only amount (delivery fee
  // used to be paid separately in cash), so this is a safe, accurate fill.
  if (!this.items_subtotal && this.totalAmount) {
    this.items_subtotal = this.totalAmount;
  }

  if (this.isNew && !this.order_id) {
    const counter = await Counter.findByIdAndUpdate(
      'orderNumber',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const seq = counter.seq.toString().padStart(4, '0');
    this.order_id = `SLH-${seq}`;
  }
  next();
});

export default mongoose.model('Order', orderSchema);