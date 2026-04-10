import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Payment from './models/Payment.js';
import Membership from './models/Membership.js';

dotenv.config();

const findOrphans = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        
        // Find payments with planId but no membershipId recorded in the payment record
        // OR find payments where no membership exists with this paymentId
        const news = await Payment.find({ planId: { $exists: true } }).sort({createdAt: -1}).limit(20);
        
        const orphans = [];
        for (const p of news) {
            const m = await Membership.findOne({ paymentId: p._id });
            if (!m) {
                orphans.push({
                    id: p._id,
                    user: p.userId,
                    plan: p.planId,
                    amount: p.amount,
                    date: p.createdAt
                });
            }
        }
        
        console.log(JSON.stringify(orphans, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

findOrphans();
