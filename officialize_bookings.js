import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './models/Booking.js';
import { getNextBookingNumber } from './utils/sequenceGenerator.js';

dotenv.config();

const officialize = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Find all bookings with temp prefixes
        const tempBookings = await Booking.find({
            bookingNumber: { $regex: /REPAIR|HEAL|BK-PKG|REF-TBD|PKG/i }
        });

        console.log(`Found ${tempBookings.length} temporary bookings to officialize.`);

        for (const b of tempBookings) {
            const oldNum = b.bookingNumber;
            const newNum = await getNextBookingNumber();
            
            b.bookingNumber = newNum;
            await b.save();
            
            console.log(`Updated: ${oldNum} -> ${newNum}`);
        }

        console.log('\nAll temporary bookings have been officialized!');
        process.exit(0);
    } catch (error) {
        console.error('Error during officialization:', error);
        process.exit(1);
    }
};

officialize();
