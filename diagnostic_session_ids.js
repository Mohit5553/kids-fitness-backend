import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Session from './models/Session.js';

dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const ids = ['69cb63228e12697cf70bd6ae', '69ccb67fecc7158a84eb61e0'];
        
        for (const id of ids) {
            const s = await Session.findById(id).populate('locationId', 'name');
            if (s) {
                console.log(`Session ${id}:`);
                console.log(`- Start: ${s.startTime}`);
                console.log(`- Location: ${s.locationId?.name || 'NULL'}`);
                console.log(`- Status: ${s.status}`);
            } else {
                console.log(`Session ${id} not found`);
            }
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

run();
