import mongoose from 'mongoose';

const salesOrderSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    guestDetails: {
      name: { type: String },
      email: { type: String },
      phone: { type: String }
    },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const SalesOrder = mongoose.model('SalesOrder', salesOrderSchema);
export default SalesOrder;
