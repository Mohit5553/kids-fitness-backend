import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Attendance from './models/Attendance.js';
import Session from './models/Session.js';
import Class from './models/Class.js';
import Trainer from './models/Trainer.js';

dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const now = new Date();
        const startOfDay = new Date(now.setHours(0,0,0,0));
        
        const records = await Attendance.find({
            createdAt: { $gte: startOfDay }
        }).populate({
            path: 'sessionId',
            populate: { path: 'classId', select: 'title' }
        }).populate('childId', 'name');

        console.log(`Deep diagnostic: ${records.length} records found`);
        records.forEach(r => {
            console.log(`Record ID: ${r._id}`);
            console.log(`Participant: ${r.participantName || r.childId?.name || r.childId}`);
            console.log(`Session ID: ${r.sessionId?._id || r.sessionId}`);
            console.log(`Class Title: ${r.sessionId?.classId?.title}`);
            console.log(`Status: ${r.status}`);
            console.log('---');
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

run();
