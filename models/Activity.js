import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const Activity = mongoose.model('Activity', activitySchema);
export default Activity;
