import mongoose from 'mongoose';
import getNextSequence from '../utils/getNextSequence.js';

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
  invoiceNumber: { type: String, unique: true, sparse: true }, // INV-000001 — always unique, assigned once at creation
  // ✅ Manual discount — applied at POS by staff (e.g. loyalty, manager
  // override). NOT automatic promo matching — that's a separate, larger
  // feature (matching Promo rules against cart contents) not yet wired
  // into checkout. This is deliberately simple: an amount + a label.
  discount_amount: { type: Number, default: 0 },
  discount_label: { type: String, default: '' },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },

  // ─── Unified POS + Website meal-combo ordering fields ──────────────
  source: { type: String, enum: ['store', 'website'], default: 'website' },
  // ✅ For source: 'store' orders only — replaces the meaningless "Pickup"
  // label that in-person POS sales used to get. Never applies to website
  // orders, which continue to use delivery_method (delivery/pickup) as normal.
  pos_sale_type: { type: String, enum: ['shop', 'restaurant', null], default: null },

  // ✅ Staff Shift & POS Tracking — every POS sale is automatically linked
  // to whoever is logged in and on an active shift. Staff never type their
  // own name; this is always set server-side from the authenticated session.
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  staffNameSnapshot: { type: String, default: '' }, // captured at sale time — survives staff renames/deletion
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', default: null },

  // ✅ Website Order Tagging — a staff member claims a pending online order
  // for themselves ("Tag to Me"). Separate from staffId/shiftId above,
  // since tagging happens AFTER the order already exists, and only one
  // staff member may hold a given order at a time.
  taggedStaffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  taggedStaffName: { type: String, default: '' },
  taggedShiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', default: null },
  taggedAt: { type: Date, default: null },
  paymentMethod: { type: String, enum: ['CASH', 'TRANSFER', 'POS', 'SPLIT', 'WEBSITE PAYMENT'], default: 'WEBSITE PAYMENT' },
  // ✅ Split Payment — only populated when paymentMethod === 'SPLIT'. Each
  // entry's amount is in ₦, and the entries must sum to exactly totalAmount
  // (enforced server-side in checkout.js, not just trusted from the client).
  splitPayments: [{
    method: { type: String, enum: ['CASH', 'TRANSFER', 'POS'] },
    amount: { type: Number },
    _id: false,
  }],
  staffName: { type: String, default: '' },
  mealPackages: { type: Array, default: [] }, // priced meal packages (meals, protein, portions, extra portions)
  storeExtras: { type: Array, default: [] },  // priced standalone extras (hotdog, water, plantain, etc.)
  lunchBoxesUsed: { type: Number, default: 0 },
  mealsTotal: { type: Number, default: 0 },
  extrasTotal: { type: Number, default: 0 },

  // ─── Platform Order Recording — third-party delivery platforms recorded
  // manually at POS, with no API integration required. 'Walk-in' is the
  // default for ordinary in-store sales; every other value requires an
  // External Order ID (enforced in checkout.js). ──────────────────────
  platform: { type: String, enum: ['Walk-in', 'Glovo', 'Chowdeck', 'Uber Eats', 'Other'], default: 'Walk-in' },
  externalOrderId: { type: String, default: '', trim: true },
}, { timestamps: true });

// 🔒 Prevents the same platform + External Order ID from ever being
// recorded twice (e.g. re-entering the same Glovo order by accident).
// Partial index — only applies once externalOrderId is actually set, so
// ordinary Walk-in orders (which never set it) are unaffected.
orderSchema.index(
  { platform: 1, externalOrderId: 1 },
  { unique: true, partialFilterExpression: { externalOrderId: { $type: 'string', $ne: '' } } }
);

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

  // ✅ Invoice numbers — sequential, permanent, assigned exactly once at
  // creation via the shared Counter collection. Applies to every order
  // regardless of how it was created (POS, website, WhatsApp).
  if (this.isNew && !this.invoiceNumber) {
    const seq = await getNextSequence('invoiceNumber');
    this.invoiceNumber = `INV-${String(seq).padStart(6, '0')}`;
  }
  next();
});

export default mongoose.model('Order', orderSchema);