import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import User from './models/User.js';

dotenv.config();

const reset = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const email = 'damilareadegboye87@gmail.com';
    const newPassword = 'admin123';

    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found');
      process.exit(1);
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    console.log(`✅ Password for ${email} reset to: ${newPassword}`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

reset();