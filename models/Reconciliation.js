import mongoose from 'mongoose';

const reconciliationSchema = new mongoose.Schema({
  date: { type: Date, required: true, default: Date.now },
  items: [{
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    name: String,
    expectedStock: { type: Number, default: 0 }, // system's calculated remaining
    actualStock: { type: Number, default: 0 },   // physical count entered by closing staff
    difference: { type: Number, default: 0 },    // actual - expected
  }],
  status: { type: String, enum: ['Verified', 'Mismatch'], default: 'Verified' },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('Reconciliation', reconciliationSchema);
