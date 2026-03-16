import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    guestDetails: {
      name: { type: String },
      email: { type: String },
      phone: { type: String }
    },
    participants: [
      {
        name: { type: String, required: true },
        age: { type: Number, required: true },
        gender: { type: String },
        childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child' }
      }
    ],
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
    date: { type: Date, required: true },
    totalAmount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    paymentMethod: { type: String, enum: ['online', 'center'], default: 'center' },
    paymentStatus: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    paymentReference: { type: String },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    paymentDate: { type: Date },
    refundStatus: { type: String, enum: ['none', 'requested', 'refunded', 'declined'], default: 'none' }
  },
  { timestamps: true }
);

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;
