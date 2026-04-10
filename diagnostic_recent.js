import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Payment from './models/Payment.js';
import Membership from './models/Membership.js';
import Booking from './models/Booking.js';
import User from './models/User.js';
import Plan from './models/Plan.js';

dotenv.config();

const check = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');
        
        const news = await Payment.find().sort({createdAt: -1}).limit(10).populate('userId', 'name email');
        
        const results = [];
        for(const p of news) {
            const m = await Membership.findOne({ paymentId: p._id }).populate('planId', 'name');
            const b = m ? await Booking.findById(m.bookingId) : null;
            
            results.push({
                user: p.userId?.email || 'N/A',
                date: p.createdAt,
                amount: p.amount,
                plan: m?.planId?.name || 'N/A',
                membership: m?._id || 'MISSING',
                bookingNum: b?.bookingNumber || 'REF-TBD',
                participants: b?.participants?.length || 0
            });
        }
        
        console.table(results);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

check();
