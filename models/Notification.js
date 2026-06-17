import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: [
      'new_order', 
      'payment_receipt', 
      'payment_approved', 
      'order_status', 
      'new_review', 
      'new_contact',
      'payment'             // ✅ added
    ],
    required: true 
  },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  relatedId: { type: mongoose.Schema.Types.ObjectId }, // orderId / reviewId / contactId
}, { timestamps: true });

export default mongoose.model('Notification', notificationSchema);