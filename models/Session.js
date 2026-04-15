import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    classId: { type: mongoose.Schema.Types.ObjectId, refPath: 'classType', required: true },
    classType: { type: String, enum: ['Class', 'Plan'], default: 'Class' },
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trainer' },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    capacity: { type: Number, default: 12 },
    bookedParticipants: { type: Number, default: 0 },
    location: { type: String },
    status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled' },
    trainerStatus: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    cancellationReason: { type: String },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date },
    membershipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Membership' },
    attendanceStatus: { type: String, enum: ['booked', 'present', 'absent'], default: 'booked' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const Session = mongoose.model('Session', sessionSchema);
export default Session;
