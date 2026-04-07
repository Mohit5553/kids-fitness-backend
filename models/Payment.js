import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    groupId: { type: String },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder' },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
    membershipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Membership' },
    amount: { type: Number, required: true },
    paymentMethod: { type: String, default: 'card' },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    reference: { type: String },
    last4: { type: String },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
