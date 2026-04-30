import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from './models/Session.js';
import Membership from './models/Membership.js';
import Booking from './models/Booking.js';
import Plan from './models/Plan.js';

dotenv.config();

async function diagnose() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  await mongoose.connect(uri);
  console.log('Connected to DB');

  const now = new Date();
  const startOfToday = new Date(now.setHours(0,0,0,0));

  // Find all sessions for today or future
  const sessions = await Session.find({ startTime: { $gte: startOfToday } })
    .populate('classId')
    .sort({ startTime: 1 });

  console.log(`Found ${sessions.length} sessions from today onwards.`);

  const sessionGroups = {};
  sessions.forEach(s => {
    const key = `${s.startTime.toISOString()}_${s.locationId || 'no-loc'}`;
    if (!sessionGroups[key]) sessionGroups[key] = [];
    sessionGroups[key].push(s);
  });

  for (const [key, group] of Object.entries(sessionGroups)) {
    if (group.length > 1) {
      console.log(`\nPotential Duplicates at ${key}:`);
      for (const s of group) {
        console.log(`  - ID: ${s._id}, Title: ${s.classId?.name || s.classId?.title}, Type: ${s.classType}, Occupancy: ${s.bookedParticipants}`);
        
        // Find memberships linked to this session
        const memberships = await Membership.find({ generatedSessions: s._id });
        console.log(`    - Linked Memberships: ${memberships.length}`);
        
        // Find bookings linked to this session
        const bookings = await Booking.find({ sessionId: s._id });
        console.log(`    - Linked Bookings: ${bookings.length}`);
      }
    }
  }

  process.exit(0);
}

diagnose();
