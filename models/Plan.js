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
    sessionType: { type: String, enum: ['group', 'personal'], default: 'group' },
    validDays: { type: String, enum: ['weekday', 'weekend', 'both'], default: 'both' },
    timeSlots: [{ type: String }],
    trainerAllocation: { type: String, enum: ['random', 'fixed'], default: 'random' },
    extensionRules: {
      maxAllowedMissed: { type: Number, default: 2 },
      expiryBufferDays: { type: Number, default: 7 }
    },
    tagline: { type: String },
    isFeatured: { type: Boolean, default: false },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trainer' }
  },
  { timestamps: true }
);

const Plan = mongoose.model('Plan', planSchema);
export default Plan;
