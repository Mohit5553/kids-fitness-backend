import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    guestDetails: {
      name: { type: String },
      email: { type: String },
      phone: { type: String }
    },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['unpaid', 'paid', 'cancelled'], default: 'unpaid' },
    date: { type: Date, default: Date.now },
    items: [
      {
        description: { type: String, required: true },
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number, required: true },
        total: { type: Number, required: true }
      }
    ],
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;
