import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, default: '' },
  role: { type: String, default: '' },
  date: { type: Date, required: true }, // normalized to start-of-day, one record per staff per day
  checkIn: { type: Date, default: null },
  checkOut: { type: Date, default: null },
  hoursWorked: { type: Number, default: 0 },
  tasksCompleted: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'Completed'], default: 'Active' },
}, { timestamps: true });

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

export default mongoose.model('Attendance', attendanceSchema);
