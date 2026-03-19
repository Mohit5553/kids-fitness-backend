import mongoose from 'mongoose';

const childSchema = new mongoose.Schema(
  {
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
    age: { type: Number },
    birthDate: { type: Date },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    photoUrl: { type: String },
    school: { type: String },
    medicalCondition: { type: String },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const Child = mongoose.model('Child', childSchema);
export default Child;
