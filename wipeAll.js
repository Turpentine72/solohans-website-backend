import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Order from './models/Order.js';
import Counter from './models/Counter.js';

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    await Order.deleteMany({});
    await Counter.findOneAndUpdate({ _id: 'orderNumber' }, { seq: 0 }, { upsert: true });
    console.log('✅ All orders deleted, counter reset');
    process.exit();
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });