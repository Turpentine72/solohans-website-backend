import mongoose from 'mongoose';

const dailyStockSchema = new mongoose.Schema({
  date: { type: Date, required: true, default: Date.now },
  items: [{
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    name: String,
    openingStock: { type: Number, default: 0 },
    sold: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
  }],
  isClosed: { type: Boolean, default: false },
  setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('DailyStock', dailyStockSchema);
