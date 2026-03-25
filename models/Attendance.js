import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child' }, // Optional for guests
    participantName: { type: String }, // For guests or non-profile bookings
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional for guests
    checkedInAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['present', 'absent', 'late'], default: 'present' },
    method: { type: String, enum: ['qr', 'manual'], default: 'manual' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

// Unique check: A child (by ID or Name) can only be checked in once per session
attendanceSchema.index({ sessionId: 1, childId: 1, participantName: 1 }, { unique: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);
export default Attendance;
