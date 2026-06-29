import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true }, // display name, e.g. "Cashier"
  builtIn: { type: Boolean, default: false }, // built-in roles can't be deleted — they have hardcoded permissions elsewhere in the system
}, { timestamps: true });

export default mongoose.model('Role', roleSchema);
