import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { generateMembershipSessions } from './services/schedulingService.js';

const Membership = mongoose.model('Membership', new mongoose.Schema({ 
    preferredSlots: [String], 
    generatedSessions: [mongoose.Schema.Types.ObjectId] 
}, { strict: false }));

const Plan = mongoose.model('Plan', new mongoose.Schema({}, { strict: false }));

async function recover() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const mid = '69e07b2be13f0c14fb7c0252';
    const m = await Membership.findById(mid);
    
    if (!m) {
        console.error('Membership not found');
        process.exit(1);
    }

    const plan = await Plan.findById(m.planId);
    if (!plan) {
        console.error('Plan not found');
        process.exit(1);
    }

    // 1. Fix the slots
    m.preferredSlots = ['10:00 AM'];
    await m.save();
    console.log('Assigned 10:00 AM slot to membership.');

    // 2. Generate sessions
    const sessionIds = await generateMembershipSessions(m, plan);
    m.generatedSessions = sessionIds;
    await m.save();
    console.log(`Healed! Created ${sessionIds.length} sessions for the new customer.`);
    
    process.exit(0);
}

recover().catch(err => {
    console.error(err);
    process.exit(1);
});
