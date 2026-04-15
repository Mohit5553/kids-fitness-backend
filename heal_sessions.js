import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load env 
dotenv.config({ path: 'd:/jts/kids fitness/kids-fitness-backend/.env' });

const SessionSchema = new mongoose.Schema({}, { strict: false });
const Session = mongoose.model('Session', SessionSchema, 'sessions');

const MembershipSchema = new mongoose.Schema({
    generatedSessions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Session' }]
}, { strict: false });
const Membership = mongoose.model('Membership', MembershipSchema, 'memberships');

const AttendanceSchema = new mongoose.Schema({
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' }
}, { strict: false });
const Attendance = mongoose.model('Attendance', AttendanceSchema, 'attendances');

const BookingSchema = new mongoose.Schema({
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' }
}, { strict: false });
const Booking = mongoose.model('Booking', BookingSchema, 'bookings');

async function heal() {
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
                    ids: { $push: '$_id' }
                }
            },
            {
                $match: { count: { $gt: 1 } }
            }
        ]);

        console.log(`Found ${duplicates.length} groups of duplicate sessions.`);

        let totalHealed = 0;
        let totalDeleted = 0;

        for (const group of duplicates) {
            const masterId = group.ids[0];
            const loserIds = group.ids.slice(1);

            // 1. Update Memberships
            const memberships = await Membership.find({ generatedSessions: { $in: loserIds } });
            for (const membership of memberships) {
                // Filter out losers
                let updated = membership.generatedSessions.filter(sid => 
                    !loserIds.some(lid => lid.equals(sid))
                );
                // Add master if not already present
                if (!updated.some(sid => sid.equals(masterId))) {
                    updated.push(masterId);
                }
                membership.generatedSessions = updated;
                await membership.save();
            }

            // 2. Update Attendance
            await Attendance.updateMany(
                { sessionId: { $in: loserIds } },
                { $set: { sessionId: masterId } }
            );

            // 3. Update Bookings
            await Booking.updateMany(
                { sessionId: { $in: loserIds } },
                { $set: { sessionId: masterId } }
            );

            // 4. Delete Clones
            const deleteResult = await Session.deleteMany({ _id: { $in: loserIds } });

            totalHealed++;
            totalDeleted += deleteResult.deletedCount;
            console.log(`Merged ${loserIds.length} sessions at ${group._id.startTime} into Session ${masterId}`);
        }

        console.log(`\nHealing Complete!`);
        console.log(`Groups merged: ${totalHealed}`);
        console.log(`Redundant records deleted: ${totalDeleted}`);

        process.exit(0);
    } catch (err) {
        console.error('Healing failed:', err);
        process.exit(1);
    }
}

heal();
