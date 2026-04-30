import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from './models/Session.js';
import Membership from './models/Membership.js';
import Booking from './models/Booking.js';

dotenv.config();

async function repair() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  await mongoose.connect(uri);
  console.log('Connected to DB');

  const now = new Date();
  const startOfToday = new Date(now.setHours(0,0,0,0));

  const sessions = await Session.find({ 
    startTime: { $gte: startOfToday },
    status: 'scheduled'
  });

  console.log(`Reviewing ${sessions.length} upcoming/current sessions...`);

  for (const s of sessions) {
    let totalParticipants = 0;

    // 1. Count from standard bookings
    const bookings = await Booking.find({ 
        sessionId: s._id,
        status: { $ne: 'cancelled' }
    });
    bookings.forEach(b => {
        totalParticipants += (b.participants?.length || 1);
    });

    // 2. Count from memberships
    const memberships = await Membership.find({ 
        generatedSessions: s._id,
        // status: 'active' // Broadened to include all who have a slot
    });
    totalParticipants += memberships.length;

    if (s.bookedParticipants !== totalParticipants) {
        console.log(`Repairing Session ${s._id} (${s.startTime.toISOString()}): ${s.bookedParticipants} -> ${totalParticipants}`);
        s.bookedParticipants = totalParticipants;
        await s.save();
    }
  }

  console.log('Repair complete.');
  process.exit(0);
}

repair();
