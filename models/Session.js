import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trainer' },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    capacity: { type: Number, default: 12 },
    bookedParticipants: { type: Number, default: 0 },
    location: { type: String },
    status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled' },
    cancellationReason: { type: String },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const Session = mongoose.model('Session', sessionSchema);
export default Session;
