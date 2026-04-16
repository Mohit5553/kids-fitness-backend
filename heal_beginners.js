import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const SessionSchema = new mongoose.Schema({ 
    classId: mongoose.Schema.Types.ObjectId, 
    classType: String, 
    isManual: Boolean 
}, { strict: false });

async function heal() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const classId = '69b7e44d4e5654a078e51603'; // beginner Profession exercise
    
    // 1. Fix sessions specifically for this class that were marked as 'Plan'
    const res1 = await mongoose.model('Session', SessionSchema).updateMany(
        { classId: new mongoose.Types.ObjectId(classId) },
        { $set: { classType: 'Class', isManual: true } }
    );
    console.log('Fixed Beginner Sessions:', res1.modifiedCount);

    // 2. Fix all 'Class' sessions missing the manual flag
    const res2 = await mongoose.model('Session', SessionSchema).updateMany(
        { classType: 'Class', isManual: { $exists: false } },
        { $set: { isManual: true } }
    );
    console.log('Fixed Legacy Manual Flag:', res2.modifiedCount);

    process.exit(0);
}

heal().catch(err => {
    console.error(err);
    process.exit(1);
});
