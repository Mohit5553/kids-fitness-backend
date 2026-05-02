import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const bookingSchema = new mongoose.Schema({
  paymentStatus: String,
  createdAt: Date,
  date: Date,
  bookingNumber: String,
  status: String
});
const Booking = mongoose.model('Booking', bookingSchema);

async function audit() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const start = new Date('2026-04-20');
    const end = new Date('2026-05-01');
    
    const bookings = await Booking.find({
      createdAt: { $gte: start, $lte: end }
    });
    
    console.log(`Found ${bookings.length} total bookings created between 20-30 April`);
    
    const statuses = {};
    bookings.forEach(b => {
      statuses[b.paymentStatus] = (statuses[b.paymentStatus] || 0) + 1;
    });
    console.log('Payment Statuses:', statuses);

    const bookingDates = {};
    bookings.forEach(b => {
       const d = b.createdAt.toISOString().slice(0, 10);
       bookingDates[d] = (bookingDates[d] || 0) + 1;
    });
    console.log('Creation Dates:', bookingDates);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

audit();
