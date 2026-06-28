import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  date: { type: Date, required: true, default: Date.now },
  category: { type: String, required: true, trim: true }, // e.g. "Ingredients", "Utilities", "Transport"
  amount: { type: Number, required: true, min: 0 },
  description: { type: String, default: '' },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('Expense', expenseSchema);
