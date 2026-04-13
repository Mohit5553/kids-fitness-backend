import mongoose from 'mongoose';

const classSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    ageGroup: { type: String },
    minAge: { type: Number },
    maxAge: { type: Number },
    genderRestriction: { type: String, enum: ['male', 'female', 'any'], default: 'any' },
    duration: { type: String },
    availableTrainers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Trainer' }],
    price: { type: Number, required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    imageUrl: { type: String },
    taxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tax' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

const ClassModel = mongoose.model('Class', classSchema);
export default ClassModel;
