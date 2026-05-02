import mongoose from 'mongoose';
import Payment from './models/Payment.js';
import Booking from './models/Booking.js';
import dotenv from 'dotenv';
dotenv.config();

async function audit() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const start = new Date('2026-04-20');
  const end = new Date('2026-04-30');
  
  const payments = await Payment.find({
    createdAt: { $gte: start, $lte: end }
  }).populate('userId', 'name').populate('bookingId');
  
  console.log(`Found ${payments.length} payments between April 20 and April 30`);
  
  payments.forEach(p => {
    console.log(`- Date: ${p.createdAt.toISOString().slice(0, 10)}, User: ${p.userId?.name}, Amount: ${p.amount}, Status: ${p.status}, Loc: ${p.locationId}, Booking: ${p.bookingId?._id}`);
  });

  const bookings = await Booking.find({
    createdAt: { $gte: start, $lte: end },
    paymentStatus: 'completed'
  });
  console.log(`Found ${bookings.length} completed bookings in range`);

  process.exit(0);
}

audit();
