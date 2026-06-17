import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  // Business info
  name: { type: String, default: 'Solohans Delicious Meals' },
  logo: { type: String, default: '' },
  tagline: { type: String, default: 'Delicious Meals' },
  phone: { type: String, default: '+234 808 194 1298' },
  whatsapp: { type: String, default: '+234 808 194 1298' },
  email: { type: String, default: 'info@solohans.com' },
  address: { type: String, default: 'Adeniran Ogunsanya Street, Surulere, Lagos, Nigeria' },
  mapUrl: { type: String, default: 'https://maps.google.com/maps?q=Adeniran%20Ogunsanya%20Street%2C%20Surulere%2C%20Lagos&output=embed' },
  workingHours: { type: String, default: 'Monday – Sunday<br />8:00 AM – 10:00 PM' },

  // Social links
  social: {
    facebook: { type: String, default: 'https://www.facebook.com/SoloHansDelicious' },
    instagram: { type: String, default: 'https://www.instagram.com/solohansdeliciousmeal50' },
    tiktok: { type: String, default: 'https://www.tiktok.com/@solohans.delicious.meals' },
    snapchat: { type: String, default: '' },
  },

  // Payment settings
  payment: {
    bankName: { type: String, default: 'Access Bank' },
    accountNumber: { type: String, default: '0123456789' },
    accountName: { type: String, default: 'Solohans Delicious Meals' },
    paystackPublicKey: { type: String, default: '' },
    paystackSecretKey: { type: String, default: '' },
  },

  // ✅ Legal pages content – editable from admin
  privacyPolicy: { type: String, default: '' },
  termsOfService: { type: String, default: '' },
  paymentPolicy: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Settings', settingsSchema);