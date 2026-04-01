import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './models/Booking.js';

dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const now = new Date();
        const startOfDay = new Date(now.setHours(0,0,0,0));
        
        const bookings = await Booking.find({
            status: 'attended',
            updatedAt: { $gte: startOfDay }
        });

        console.log(`Found ${bookings.length} attended bookings updated today:`);
        bookings.forEach(b => {
            console.log(`Booking ID: ${b._id}`);
            console.log(`- Participants: ${b.participants.map(p => p.name).join(', ')}`);
            console.log(`- Session ID: ${b.sessionId}`);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

run();
