import mongoose from 'mongoose';

const specialtySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

const Specialty = mongoose.model('Specialty', specialtySchema);
export default Specialty;
