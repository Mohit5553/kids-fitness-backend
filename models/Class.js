import mongoose from 'mongoose';

const classSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    ageGroup: { type: String },
    duration: { type: String },
    availableTrainers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Trainer' }],
    price: { type: Number, required: true },
    capacity: { type: Number, default: 12 },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const ClassModel = mongoose.model('Class', classSchema);
export default ClassModel;
