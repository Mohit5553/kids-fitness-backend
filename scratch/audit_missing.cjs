const mongoose = require('mongoose');
require('dotenv').config();

const bookingSchema = new mongoose.Schema({
  paymentStatus: String,
  createdAt: Date,
  date: Date,
  bookingNumber: String
});
const Booking = mongoose.model('Booking', bookingSchema);

const paymentSchema = new mongoose.Schema({
  bookingId: mongoose.Schema.Types.ObjectId,
  createdAt: Date
});
const Payment = mongoose.model('Payment', paymentSchema);

async function audit() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const start = new Date('2026-04-20');
  const end = new Date('2026-05-01');
  
  const completedBookings = await Booking.find({
    paymentStatus: 'completed',
    createdAt: { $gte: start, $lte: end }
  });
  
  console.log(`Found ${completedBookings.length} completed bookings created between 20-30 April`);
  
  for (const b of completedBookings) {
    const p = await Payment.findOne({ bookingId: b._id });
    if (!p) {
      console.log(`MISSING PAYMENT for Booking: ${b.bookingNumber}, CreatedAt: ${b.createdAt.toISOString()}`);
    }
  }

  process.exit(0);
}

audit();
