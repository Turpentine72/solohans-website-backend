import mongoose from 'mongoose';
import Counter from './models/Counter.js';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
await Counter.deleteOne({ _id: 'orderNumber' });
console.log('✅ Order counter reset. Next order will be SLH-0001');
await mongoose.disconnect();  