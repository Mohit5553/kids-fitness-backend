import mongoose from 'mongoose';

const taxSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    value: { type: Number, required: true },
    type: { type: String, enum: ['percentage', 'flat'], default: 'percentage' },
    validityStart: { type: Date },
    validityEnd: { type: Date },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    calculationMethod: { type: String, enum: ['inclusive', 'exclusive'], default: 'exclusive' },
    description: { type: String }
  },
  { timestamps: true }
);

const Tax = mongoose.model('Tax', taxSchema);
export default Tax;
