import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from './models/Session.js';

dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const now = new Date();
        const startOfDay = new Date(now.setHours(0,0,0,0));
        const endOfDay = new Date(now.setHours(23,59,59,999));

        console.log(`Checking sessions between ${startOfDay.toISOString()} and ${endOfDay.toISOString()}`);

        const sessions = await Session.find({
            startTime: { $gte: startOfDay, $lte: endOfDay }
        }).populate('classId', 'title');

        console.log(`Found ${sessions.length} sessions for today:`);
        sessions.forEach(s => {
            console.log(`- ${s.classId?.title} at ${s.startTime.toISOString()} (End: ${s.endTime?.toISOString()})`);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

run();
