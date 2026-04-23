import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from './models/Session.js';
import Membership from './models/Membership.js';
import User from './models/User.js';
import Child from './models/Child.js';
import Plan from './models/Plan.js';
import { initCronJobs } from './utils/cronJobs.js';

dotenv.config();

const diagnosticMemberships = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        // 1. Find or create a session starting tomorrow
        let session = await Session.findOne({
            startTime: { $gte: new Date(tomorrow.getTime() - 3600000), $lte: new Date(tomorrow.getTime() + 3600000) }
        });

        if (!session) {
            console.log('No session found for tomorrow. Creating a test session...');
            const testPlan = await Plan.findOne() || await Plan.create({ name: 'Test Plan', price: 100, duration: 30, classType: 'Plan' });
            session = await Session.create({
                classId: testPlan._id,
                classType: 'Plan',
                trainerId: new mongoose.Types.ObjectId(),
                startTime: tomorrow,
                endTime: new Date(tomorrow.getTime() + 3600000),
                status: 'scheduled',
                location: 'Diagnostic Studio'
            });
        }

        console.log(`Using session: ${session._id} starting at ${session.startTime}`);

        // 2. Find or create a membership for this session
        let membership = await Membership.findOne({ generatedSessions: session._id });

        if (!membership) {
            console.log('No membership found for this session. Creating a test membership...');
            const user = await User.findOne({ email: 'admin@test.com' }) || await User.create({ name: 'Admin', email: 'admin@test.com', password: 'password', role: 'admin' });
            const child = await Child.findOne() || await Child.create({ name: 'Little Explorer', userId: user._id });
            
            membership = await Membership.create({
                userId: user._id,
                childId: child._id,
                planId: session.classId,
                status: 'active',
                generatedSessions: [session._id],
                remindedSessions: []
            });
        }

        console.log(`Using membership: ${membership._id} for child ${membership.childId}`);
        console.log(`Current remindedSessions: ${membership.remindedSessions}`);

        // 3. Manually trigger the cron job logic (the meat of it)
        const tomorrowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
        const tomorrowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

        const upcomingSessions = await Session.find({
            startTime: { $gte: tomorrowStart, $lte: tomorrowEnd },
            status: 'scheduled'
        }).populate('classId', 'title name');

        console.log(`Diagnostic: Found ${upcomingSessions.length} sessions in window.`);

        for (const s of upcomingSessions) {
            const pendingMemberships = await Membership.find({
                status: 'active',
                generatedSessions: s._id,
                remindedSessions: { $ne: s._id }
            }).populate('userId', 'name email firstName')
              .populate('childId', 'name')
              .populate('planId', 'name');

            console.log(`Diagnostic: Session ${s._id} has ${pendingMemberships.length} memberships to remind.`);

            for (const m of pendingMemberships) {
                console.log(`WOULD SEND EMAIL TO: ${m.userId.email} for child ${m.childId.name}`);
                // In a real run, it would call mailer.
                // We'll simulate success
                m.remindedSessions.push(s._id);
                await m.save();
                console.log(`Updated membership ${m._id} remindedSessions: ${m.remindedSessions}`);
            }
        }

        console.log('\nDiagnostic complete. Check if membership remindedSessions was updated.');
        process.exit(0);
    } catch (err) {
        console.error('Diagnostic failed:', err);
        process.exit(1);
    }
};

diagnosticMemberships();
