import mongoose from 'mongoose';

const trialSchema = new mongoose.Schema(
  {
    parentName: { type: String, required: true },
    parentEmail: { type: String, required: true },
    parentPhone: { type: String },
    childName: { type: String, required: true },
    childAge: { type: Number },
    preferredClass: { type: String },
    preferredTime: { type: String },
    status: { type: String, enum: ['new', 'contacted', 'booked', 'closed'], default: 'new' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const Trial = mongoose.model('Trial', trialSchema);
export default Trial;
