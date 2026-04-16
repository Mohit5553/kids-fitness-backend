import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Membership from './models/Membership.js';

dotenv.config();

const diagnose = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const memberships = await Membership.find({ status: 'active' }).populate('planId', 'name').limit(10);
    console.log('--- ACTIVE MEMBERSHIPS ---');
    memberships.forEach(m => {
        console.log(`- Member ID: ${m._id}, Plan: ${m.planId?.name}, Location: ${m.locationId}`);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

diagnose();
