import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: 'd:/jts/kids fitness/kids-fitness-backend/.env' });

const SessionSchema = new mongoose.Schema({
    classId: { type: mongoose.Schema.Types.ObjectId, required: true },
    classType: { type: String, enum: ['Class', 'Plan'], default: 'Class' }
}, { strict: false });
const Session = mongoose.model('Session', SessionSchema, 'sessions');

const PlanSchema = new mongoose.Schema({}, { strict: false });
const Plan = mongoose.model('Plan', PlanSchema, 'plans');

const ClassSchema = new mongoose.Schema({}, { strict: false });
const ClassModel = mongoose.model('Class', ClassSchema, 'classes');

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const sessions = await Session.find({});
        console.log(`Analyzing ${sessions.length} sessions...`);

        let planCount = 0;
        let classCount = 0;

        for (const session of sessions) {
            // Check if classId belongs to a Plan
            const planExists = await Plan.exists({ _id: session.classId });
            
            if (planExists) {
                session.classType = 'Plan';
                planCount++;
            } else {
                session.classType = 'Class';
                classCount++;
            }
            await session.save();
        }

        console.log(`\nMigration Complete!`);
        console.log(`Sessions marked as 'Plan': ${planCount}`);
        console.log(`Sessions marked as 'Class': ${classCount}`);

        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
