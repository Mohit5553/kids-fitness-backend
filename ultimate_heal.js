import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const SessionSchema = new mongoose.Schema({ 
    startTime: Date,
    classId: mongoose.Schema.Types.ObjectId,
    classType: String,
    locationId: mongoose.Schema.Types.ObjectId,
    status: String
}, { strict: false });

const MembershipSchema = new mongoose.Schema({
    generatedSessions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Session' }],
    locationId: mongoose.Schema.Types.ObjectId
}, { strict: false });

const AttendanceSchema = new mongoose.Schema({ sessionId: mongoose.Schema.Types.ObjectId }, { strict: false });
const BookingSchema = new mongoose.Schema({ sessionId: mongoose.Schema.Types.ObjectId }, { strict: false });

async function ultimateHeal() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const Session = mongoose.model('Session', SessionSchema);
    const Membership = mongoose.model('Membership', MembershipSchema);
    const Attendance = mongoose.model('Attendance', AttendanceSchema);
    const Booking = mongoose.model('Booking', BookingSchema);

    // Group only by classId and startTime (disregard locationId for now to catch duplicates)
    const duplicates = await Session.aggregate([
        { $match: { status: 'scheduled' } },
        {
            $group: {
                _id: {
                    classId: '$classId',
                    startTime: '$startTime'
                },
                count: { $sum: 1 },
                allDocs: { $push: '$$ROOT' }
            }
        },
        { $match: { count: { $gt: 1 } } }
    ]);

    console.log(`Found ${duplicates.length} groups of potential duplicates.`);

    let totalMerged = 0;

    for (const group of duplicates) {
        // Sort sessions so the one WITH a locationId is first
        const sorted = group.allDocs.sort((a, b) => (b.locationId ? 1 : 0) - (a.locationId ? 1 : 0));
        
        const master = sorted[0];
        const masterId = master._id;
        const loserIds = sorted.slice(1).map(s => s._id);

        console.log(`Merging ${loserIds.length} sessions at ${master.startTime.toISOString()} into Master ${masterId} [Class: ${master.classId}]`);

        // 1. Update Memberships
        const memberships = await Membership.find({ generatedSessions: { $in: loserIds } });
        for (const m of memberships) {
            let updated = m.generatedSessions.filter(sid => !loserIds.some(lid => lid.equals(sid)));
            if (!updated.some(sid => sid.equals(masterId))) {
                updated.push(masterId);
            }
            m.generatedSessions = updated;
            
            // Self-heal: If master has no location but membership does, fix master
            if (!master.locationId && m.locationId) {
                master.locationId = m.locationId;
                await Session.findByIdAndUpdate(masterId, { $set: { locationId: m.locationId } });
            }
            
            await m.save();
        }

        // 2. Update Attendance & Bookings
        await Attendance.updateMany({ sessionId: { $in: loserIds } }, { $set: { sessionId: masterId } });
        await Booking.updateMany({ sessionId: { $in: loserIds } }, { $set: { sessionId: masterId } });

        // 3. Delete duplicates
        await Session.deleteMany({ _id: { $in: loserIds } });
        totalMerged += loserIds.length;
    }

    console.log(`Healing finished. Deleted ${totalMerged} duplicate sessions.`);
    process.exit(0);
}

ultimateHeal().catch(err => {
    console.error(err);
    process.exit(1);
});
