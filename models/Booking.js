import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
    date: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;
