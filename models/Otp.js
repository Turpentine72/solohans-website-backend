import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  otp: {
    type: String,
    required: true,
  },
  purpose: { type: String, enum: ['reset', 'change'], default: 'reset' },
  pendingPasswordHash: { type: String, default: '' }, // for 'change' purpose — applied once OTP verifies
  attempts: { type: Number, default: 0 },     // wrong-OTP attempts — max 3
  resendCount: { type: Number, default: 0 },  // how many times this OTP has been resent — max 3
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }, // ✅ MongoDB auto-deletes after expiry
  },
});

export default mongoose.model('Otp', otpSchema);