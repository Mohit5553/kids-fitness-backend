import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from './models/Session.js';
import Membership from './models/Membership.js';
import Plan from './models/Plan.js';

dotenv.config();

async function splitSessions() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  await mongoose.connect(uri);
  console.log('Connected to DB');

  const now = new Date();
  const startOfToday = new Date(now.setHours(0,0,0,0));

  const sessions = await Session.find({ 
    status: 'scheduled', 
    startTime: { $gte: startOfToday }, // Include all today
    classType: 'Plan'
  });

  console.log(`Checking ${sessions.length} sessions for cross-package merging...`);

  let fixCount = 0;

  for (const s of sessions) {
    const memberships = await Membership.find({ generatedSessions: s._id });
    if (memberships.length === 0) continue;

    const planGroups = {};
    memberships.forEach(m => {
      const pId = m.planId.toString();
      if (!planGroups[pId]) planGroups[pId] = [];
      planGroups[pId].push(m);
    });

    const uniquePlanIds = Object.keys(planGroups);

    if (uniquePlanIds.length > 1) {
      console.log(`Found session ${s._id} (${s.startTime.toISOString()}) with ${uniquePlanIds.length} different plans.`);
      
      const primaryPlanId = s.classId ? s.classId.toString() : uniquePlanIds[0];
      
      for (const pId of uniquePlanIds) {
        if (pId === primaryPlanId) continue; 

        console.log(`  - Moving ${planGroups[pId].length} members to a new session for Plan ${pId}`);

        const newSession = await Session.create({
          classId: pId,
          trainerId: s.trainerId,
          startTime: s.startTime,
          endTime: s.endTime,
          capacity: s.capacity,
          location: s.location,
          status: 'scheduled',
          locationId: s.locationId,
          classType: 'Plan',
          trainerStatus: s.trainerStatus
        });

        for (const m of planGroups[pId]) {
          await Membership.updateOne({ _id: m._id }, { $pull: { generatedSessions: s._id } });
          await Membership.updateOne({ _id: m._id }, { $addToSet: { generatedSessions: newSession._id } });
        }

        newSession.bookedParticipants = planGroups[pId].length;
        await newSession.save();
        
        s.bookedParticipants -= planGroups[pId].length;
        fixCount++;
      }
      await s.save();
    }
  }

  console.log(`\nRepair complete. Fixed ${fixCount} cross-package issues.`);
  process.exit(0);
}

splitSessions();
