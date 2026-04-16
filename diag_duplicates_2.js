import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const SessionSchema = new mongoose.Schema({ 
    startTime: Date,
    endTime: Date,
    classId: mongoose.Schema.Types.ObjectId,
    classType: String,
    locationId: mongoose.Schema.Types.ObjectId
}, { strict: false });

async function diagnose() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected');

    const dayStart = new Date('2026-04-18T00:00:00.000Z');
    const dayEnd = new Date('2026-04-18T23:59:59.000Z');

    const sessions = await mongoose.model('Session', SessionSchema).find({
        startTime: { $gte: dayStart, $lte: dayEnd }
    }).populate({ path: 'classId', strictPopulate: false });

    console.log('FOUND:', sessions.length, 'sessions');
    
    sessions.forEach(s => {
        // Log EVERYTHING for these sessions
        console.log('SESSION_DETAIL:', JSON.stringify({
            id: s._id,
            start: s.startTime.toISOString(),
            end: s.endTime?.toISOString(),
            classId: s.classId?._id,
            className: s.classId?.title || s.classId?.name,
            locationId: s.locationId,
            classType: s.classType
        }, null, 2));
    });

    process.exit(0);
}

diagnose().catch(err => {
    console.error(err);
    process.exit(1);
});
