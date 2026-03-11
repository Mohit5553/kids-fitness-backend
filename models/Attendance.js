import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    checkedInAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['present', 'absent', 'late'], default: 'present' },
    method: { type: String, enum: ['qr', 'manual'], default: 'manual' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

attendanceSchema.index({ sessionId: 1, childId: 1 }, { unique: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);
export default Attendance;
