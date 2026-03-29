import mongoose from 'mongoose';

const trainerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    bio: { type: String },
    specialties: [{ type: String }],
    phone: { type: String },
    email: { type: String },
    avatarUrl: { type: String },
    gallery: [{ type: String }],
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

const Trainer = mongoose.model('Trainer', trainerSchema);
export default Trainer;
