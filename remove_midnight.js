import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from './models/Session.js';
import Membership from './models/Membership.js';

dotenv.config();

async function removeErroneousSessions() {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);
  console.log('Connected to DB');

  const start = new Date('2026-04-30T00:00:00Z');
  const end = new Date('2026-04-30T01:00:00Z');

  const sessions = await Session.find({ 
    startTime: { $gte: start, $lte: end }
  });

  console.log(`Found ${sessions.length} sessions around midnight.`);

  for (const s of sessions) {
    console.log(`Deleting session ${s._id} (${s.startTime.toISOString()})`);
    
    // Unlink from memberships
    await Membership.updateMany(
      { generatedSessions: s._id },
      { $pull: { generatedSessions: s._id } }
    );
    
    // Delete session
    await Session.deleteOne({ _id: s._id });
  }

  process.exit(0);
}

removeErroneousSessions();
