import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Attendance from './models/Attendance.js';
import User from './models/User.js';

dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const now = new Date();
        const startOfDay = new Date(now.setHours(0,0,0,0));
        
        const records = await Attendance.find({
            createdAt: { $gte: startOfDay }
        }).populate('userId', 'email name');

        console.log(`Diagnostic: ${records.length} records found`);
        records.forEach(r => {
            console.log(`Participant: ${r.participantName || r.childId}`);
            console.log(`Parent Email: ${r.userId?.email}`);
            console.log(`---`);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

run();
