import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  customer_name: { type: String, required: true },
  email: { type: String, default: '' },
  rating: { type: Number, min: 1, max: 5, required: true },
  text: { type: String, required: true },
  image: { type: String, default: '' },           // ✅ new field
  status: { type: String, enum: ['Pending', 'Approved', 'Hidden'], default: 'Pending' },
  featured: { type: Boolean, default: false },
  reply: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Review', reviewSchema);