import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from './models/Session.js';
import Booking from './models/Booking.js';
import Membership from './models/Membership.js';
import User from './models/User.js';
import Child from './models/Child.js';
import Plan from './models/Plan.js';
import ClassModel from './models/Class.js';

dotenv.config();

const verifyReminders = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('--- Reminder Logic Verification ---');
    
    const now = new Date();
    // Use Today @ current time for window calculation
    const tStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const tEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    console.log('Current Server Time (UTC):', now.toISOString());
    console.log('Verification Window Start (UTC):', tStart.toISOString());
    console.log('Verification Window End (UTC):', tEnd.toISOString());

    // 1. Check Upcoming Sessions (For Trainers & Memberships)
    const sessions = await Session.find({
      startTime: { $gte: tStart, $lte: tEnd },
      status: 'scheduled'
    }).populate('classId', 'title name');

    console.log(`\n[Sessions] Found ${sessions.length} sessions in the 24h window:`);
    sessions.forEach(s => {
      console.log(` - ID: ${s._id} | Time: ${s.startTime.toISOString()} | Class: ${s.classId?.title || s.classId?.name} | Trainer Reminded: ${s.trainerReminderSent}`);
    });

    // 2. Check Upcoming Bookings (For Regular Customers)
    const bookings = await Booking.find({
      date: { $gte: tStart, $lte: tEnd },
      status: 'confirmed'
    }).populate({ path: 'sessionId', select: 'startTime' });

    console.log(`\n[Bookings] Found ${bookings.length} individual bookings in the 24h window:`);
    bookings.forEach(b => {
      const bDate = b.date || b.sessionId?.startTime;
      console.log(` - ID: ${b._id} | Time: ${bDate?.toISOString()} | Reminded: ${b.reminderSent}`);
    });

    // 3. Check Memberships linked to these sessions
    if (sessions.length > 0) {
      const sessionIds = sessions.map(s => s._id);
      const memberships = await Membership.find({
        status: 'active',
        generatedSessions: { $in: sessionIds }
      }).populate('userId', 'email');

      console.log(`\n[Memberships] Found ${memberships.length} memberships linked to upcoming sessions:`);
      memberships.forEach(m => {
        const soonSessions = m.generatedSessions.filter(sid => sessionIds.some(target => target.equals(sid)));
        soonSessions.forEach(sid => {
          const alreadyReminded = m.remindedSessions?.some(r => r.equals(sid));
          console.log(` - Member: ${m.userId?.email} | Session: ${sid} | Already Reminded: ${alreadyReminded}`);
        });
      });
    }

    console.log('\n--- End of Verification ---');
    process.exit(0);
  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  }
};

verifyReminders();
