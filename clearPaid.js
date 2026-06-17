import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Order from './models/Order.js';

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    await Order.deleteMany({ status: 'Paid' });
    console.log('✅ All paid orders deleted – Payment Verification is now empty');
    process.exit();
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });