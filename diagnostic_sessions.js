import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load env from backend
dotenv.config({ path: 'd:/jts/kids fitness/kids-fitness-backend/.env' });

const SessionSchema = new mongoose.Schema({}, { strict: false });
const Session = mongoose.model('Session', SessionSchema, 'sessions');

async function diagnostic() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const duplicates = await Session.aggregate([
            {
                $match: { status: 'scheduled' }
            },
            {
                $group: {
                    _id: {
                        classId: '$classId',
                        startTime: '$startTime',
                        locationId: '$locationId'
                    },
                    count: { $sum: 1 },
                    ids: { $push: '$_id' },
                    membershipIds: { $push: '$membershipId' }
                }
            },
            {
                $match: { count: { $gt: 1 } }
            }
        ]);

        console.log('Found duplicate groups:', duplicates.length);
        duplicates.forEach(d => {
            console.log(`\nDuplicate found for Group:`, d._id);
            console.log(`Count: ${d.count}`);
            console.log(`IDs: ${d.ids.join(', ')}`);
            console.log(`Membership IDs present:`, d.membershipIds.filter(id => id));
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

diagnostic();
