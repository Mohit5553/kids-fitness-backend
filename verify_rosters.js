import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from './models/Session.js';
import Membership from './models/Membership.js';
import Plan from './models/Plan.js';

dotenv.config();

async function verify() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  await mongoose.connect(uri);
  console.log('Connected to DB');

  const now = new Date();
  const startOfToday = new Date(now.setHours(0,0,0,0));
  const endOfToday = new Date(now.setHours(23,59,59,999));

  const sessions = await Session.find({ 
    startTime: { $gte: startOfToday, $lte: endOfToday },
    classType: 'Plan'
  }).populate('classId', 'name');

  console.log(`Found ${sessions.length} plan sessions for today.`);

  for (const s of sessions) {
    const memberships = await Membership.find({ generatedSessions: s._id }).populate('planId', 'name');
    console.log(`\nSession ${s._id} (${s.classId?.name}) @ ${s.startTime.toISOString()}:`);
    console.log(`  - Booked Participants (field): ${s.bookedParticipants}`);
    console.log(`  - Memberships linked: ${memberships.length}`);
    
    const mismatched = memberships.filter(m => m.planId?._id.toString() !== s.classId?._id.toString());
    if (mismatched.length > 0) {
      console.log(`  - !!! MISMATCH FOUND !!!:`);
      mismatched.forEach(m => console.log(`    * Member with Plan: ${m.planId?.name}`));
    } else {
      console.log(`  - All members match the session plan.`);
    }
  }

  process.exit(0);
}

verify();
