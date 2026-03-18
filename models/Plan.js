import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    validity: { type: String },
    benefits: [{ type: String }],
    type: { type: String, enum: ['dropin', 'pack', 'term', 'subscription'], default: 'pack' },
    classesIncluded: { type: Number },
    durationWeeks: { type: Number },
    billingCycle: { type: String, enum: ['none', 'weekly', 'monthly', 'yearly'], default: 'none' },
    tagline: { type: String },
    isFeatured: { type: Boolean, default: false },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const Plan = mongoose.model('Plan', planSchema);
export default Plan;
