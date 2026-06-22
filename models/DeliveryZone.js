import mongoose from 'mongoose';

const deliveryZoneSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },   // e.g. "Ikorodu"
  fee: { type: Number, required: true, min: 0 },         // e.g. 1500
  active: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('DeliveryZone', deliveryZoneSchema);
