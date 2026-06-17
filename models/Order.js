import mongoose from 'mongoose';
import Counter from './Counter.js';                     // ✅ import counter

const orderSchema = new mongoose.Schema({
  customerEmail: { type: String, required: true },
  customerName: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  items: { type: Array, required: true },
  totalAmount: { type: Number, required: true },
  status: { type: String, default: 'Pending' },
  payment_status: { type: String, default: 'unpaid' },
  paymentRef: { type: String, default: '' },
  order_type: { type: String, default: 'card' },
  delivery_fee: { type: Number, default: 0 },
  freeDelivery: { type: Boolean, default: false },
  statusHistory: { type: Array, default: [] },
  order_id: { type: String, unique: true },            // will be auto‑generated
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

// ✅ Auto‑generate order_id before saving (if not already set)
orderSchema.pre('save', async function (next) {
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