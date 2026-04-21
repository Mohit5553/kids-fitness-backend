import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './models/Booking.js';
import Session from './models/Session.js';
import Trainer from './models/Trainer.js';
import Plan from './models/Plan.js';
import User from './models/User.js';

dotenv.config();

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('DB Connected');

    // 1. Get a trainer
    const trainer = await Trainer.findOne({ status: 'active' });
    if (!trainer) throw new Error('No active trainer found');

    // 2. Get a plan or class
    const plan = await Plan.findOne();
    if (!plan) throw new Error('No plan found');

    // 3. Get a user
    const user = await User.findOne();
    if (!user) throw new Error('No user found');

    // 4. Create a session for ~24 hours from now
    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

    const session = await Session.create({
        classId: plan._id,
        classType: 'Plan',
        startTime,
        endTime,
        trainerId: trainer._id,
        trainerStatus: 'accepted',
        status: 'scheduled',
        location: 'Test Studio',
        trainerReminderSent: false
    });
    console.log('Test Session Created:', session._id);

    // 5. Create a booking for this session
    const booking = await Booking.create({
        userId: user._id,
        bookingNumber: `TEST_${Date.now()}`,
        sessionId: session._id,
        classId: plan._id,
        date: startTime,
        totalAmount: 100,
        status: 'confirmed',
        reminderSent: false
    });
    console.log('Test Booking Created:', booking.bookingNumber);

    console.log('Verification script ready. Run diagnostic_reminders.js now.');

    await mongoose.disconnect();
}

run().catch(console.error);
