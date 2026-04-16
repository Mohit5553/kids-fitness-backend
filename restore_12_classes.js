import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { generateMembershipSessions } from './services/schedulingService.js';

const Plan = mongoose.model('Plan', new mongoose.Schema({}, { strict: false }));
const Membership = mongoose.model('Membership', new mongoose.Schema({}, { strict: false }));

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // 1. Fix the Plan configuration
    const planId = '69ab15513954a653cae832ed';
    await Plan.findByIdAndUpdate(planId, { classesIncluded: 12 });
    console.log('Corrected 12 Classes Plan config in DB.');

    // 2. Fix the specific customer membership
    const mid = '69e07b2be13f0c14fb7c0252';
    const m = await Membership.findById(mid);
    
    if (m) {
        console.log('Found Membership. Updating count to 12.');
        m.classesRemaining = 12;
        await m.save();

        // 3. Re-generate sessions
        const plan = await Plan.findById(m.planId);
        const allSessions = await generateMembershipSessions(m, plan);
        m.generatedSessions = allSessions;
        await m.save();
        console.log(`Successfully restored ${allSessions.length} sessions for the customer.`);
    } else {
        console.error('Customer membership not found.');
    }

    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
