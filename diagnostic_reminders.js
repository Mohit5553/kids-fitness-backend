import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './models/Booking.js';
import Session from './models/Session.js';
import Class from './models/Class.js';
import Plan from './models/Plan.js';
import Trainer from './models/Trainer.js';
import User from './models/User.js';

dotenv.config();

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('DB Connected');

    const now = new Date();
    const tomorrowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const tomorrowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    console.log('Window Start:', tomorrowStart.toISOString());
    console.log('Window End:  ', tomorrowEnd.toISOString());

    const pendingCustomerReminders = await Booking.find({
        status: 'confirmed',
        reminderSent: false,
        date: { $gte: tomorrowStart, $lte: tomorrowEnd }
    })
    .populate('userId', 'name email firstName')
    .populate('classId', 'title')
    .populate({
        path: 'sessionId',
        select: 'startTime location classId',
        populate: { path: 'classId', select: 'title' }
    });

    console.log(`Found ${pendingCustomerReminders.length} pending customer reminders.`);
    pendingCustomerReminders.forEach(b => {
        console.log(` - Booking ${b.bookingNumber} for ${b.date.toISOString()} (Sent: ${b.reminderSent})`);
    });

    const pendingTrainerReminders = await Session.find({
        status: 'scheduled',
        trainerReminderSent: false,
        startTime: { $gte: tomorrowStart, $lte: tomorrowEnd },
        trainerId: { $ne: null }
    })
    .populate('trainerId', 'name email')
    .populate('classId', 'title name');

    console.log(`Found ${pendingTrainerReminders.length} pending trainer reminders.`);
    pendingTrainerReminders.forEach(s => {
        console.log(` - Session ${s._id} starting ${s.startTime.toISOString()} (Sent: ${s.trainerReminderSent})`);
        if (s.trainerId) console.log(`   Trainer: ${s.trainerId.name} <${s.trainerId.email}>`);
    });

    await mongoose.disconnect();
}

run().catch(console.error);
