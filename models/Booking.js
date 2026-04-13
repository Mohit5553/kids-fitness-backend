import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    bookingNumber: { type: String, unique: true },
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
        relation: { type: String },
        childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child' }
      }
    ],
    bookingType: { type: String, enum: ['session', 'package'], default: 'session' },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
    date: { type: Date, required: true },
    totalAmount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'confirmed', 'attended', 'cancelled', 'completed'], default: 'pending' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    paymentMethod: { type: String, default: 'center' },
    paymentStatus: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    paymentReference: { type: String },
    cancellationReason: { type: String },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    paymentDate: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedByRole: { type: String },
    refundStatus: { type: String, enum: ['none', 'requested', 'refunded', 'declined'], default: 'none' },
    refundRejectionReason: { type: String },
    isCorporate: { type: Boolean, default: false },
    corporateName: { type: String },
    groupId: { type: String, index: true },
    lifecycle: {
      paidAt: Date,
      paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      attendedAt: Date,
      attendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      finalizedAt: Date,
      finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
    reminderSent: { type: Boolean, default: false },
    discountAmount: { type: Number, default: 0 },
    promotionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Promotion' },
    taxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tax' },
    taxAmount: { type: Number, default: 0 },
    couponCode: { type: String },
    couponAmount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;
