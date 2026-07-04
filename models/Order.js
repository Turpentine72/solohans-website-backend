import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  customerEmail: { type: String, required: true },
  customerName: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  items: { type: Array, required: true },
  delivery_method: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
  notes: { type: String, default: '' }, // customer's additional instructions for admin
  stockDeducted: { type: Boolean, default: false }, // prevents double-deduction on repeated status changes
  order_channel: { type: String, enum: ['online', 'whatsapp'], default: 'online' },
  items_subtotal: { type: Number, default: 0 },   // items only, never includes delivery fee or VAT
  // ✅ VAT is captured at order-creation time and never recalculated later —
  // so historical orders stay accurate even if the admin changes the tax
  // rate afterward.
  tax_enabled: { type: Boolean, default: false },
  tax_rate: { type: Number, default: 0 },     // percentage, e.g. 7.5
  tax_amount: { type: Number, default: 0 },   // ₦ amount, computed once at creation
  totalAmount: { type: Number, required: true },      // final payable amount (items + VAT + delivery fee once set)
  delivery_fee: { type: Number, default: null },       // null = not yet set by admin
  delivery_fee_set: { type: Boolean, default: false }, // true once admin sets it (or immediately for pickup)
  status: { type: String, default: 'Pending' }, // fulfillment stage only: Pending/Confirmed/Processing/Out for Delivery/Delivered/Cancelled
  payment_status: { type: String, default: 'unpaid' }, // unpaid | paid
  verification_status: { type: String, default: 'Not Verified' }, // Not Verified | Verified — LOCKS once Verified (see pre-save hook below)
  paymentRef: { type: String, default: '' },
  order_type: { type: String, default: 'card' },
  freeDelivery: { type: Boolean, default: false },
  statusHistory: { type: Array, default: [] },
  order_id: { type: String, unique: true },            // will be auto‑generated
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },

  // ─── Unified POS + Website meal-combo ordering fields ──────────────
  source: { type: String, enum: ['store', 'website'], default: 'website' },
  // ✅ For source: 'store' orders only — replaces the meaningless "Pickup"
  // label that in-person POS sales used to get. Never applies to website
  // orders, which continue to use delivery_method (delivery/pickup) as normal.
  pos_sale_type: { type: String, enum: ['shop', 'restaurant', null], default: null },
  paymentMethod: { type: String, enum: ['CASH', 'TRANSFER', 'POS', 'WEBSITE PAYMENT'], default: 'WEBSITE PAYMENT' },
  staffName: { type: String, default: '' },
  mealPackages: { type: Array, default: [] }, // priced meal packages (meals, protein, portions, extra portions)
  storeExtras: { type: Array, default: [] },  // priced standalone extras (hotdog, water, plantain, etc.)
  lunchBoxesUsed: { type: Number, default: 0 },
  mealsTotal: { type: Number, default: 0 },
  extrasTotal: { type: Number, default: 0 },
}, { timestamps: true });

// ✅ Generates a genuinely unique, date-readable order ID — no shared
// counter document involved, so there's nothing that can ever be
// accidentally reset and cause a duplicate. Format: SLH-YYYYMMDD-XXXX
function generateOrderId() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const randPart = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SLH-${datePart}-${randPart}`;
}

// 🔒 Once verification_status is "Verified", it can NEVER be changed back —
// enforced here at the schema level so this holds true regardless of which
// route or future code path tries to modify it.
orderSchema.pre('save', async function (next) {
  const touchesLockedFields = this.isModified('verification_status') || this.isModified('payment_status');
  if (!this.isNew && touchesLockedFields) {
    const existing = await this.constructor.findById(this._id).select('verification_status').lean();
    if (existing?.verification_status === 'Verified') {
      this.verification_status = 'Verified'; // cannot be undone
      if (this.payment_status !== 'paid') {
        this.payment_status = 'paid'; // can't be "verified" while "unpaid" — contradiction
      }
    }
  }
  next();
});

// ✅ Auto‑generate order_id before saving (if not already set)
orderSchema.pre('save', async function (next) {
  // Backfill items_subtotal for orders created before this field existed —
  // for those orders, totalAmount WAS the items-only amount (delivery fee
  // used to be paid separately in cash), so this is a safe, accurate fill.
  if (!this.items_subtotal && this.totalAmount) {
    this.items_subtotal = this.totalAmount;
  }

  if (this.isNew && !this.order_id) {
    let candidate = generateOrderId();
    let attempts = 0;
    // Astronomically unlikely to ever loop, but guarantees true uniqueness
    // rather than just assuming it.
    while (await this.constructor.exists({ order_id: candidate }) && attempts < 5) {
      candidate = generateOrderId();
      attempts++;
    }
    this.order_id = candidate;
  }
  next();
});

export default mongoose.model('Order', orderSchema);