import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    validity: { type: String },
    benefits: [{ type: String }],
    type: { type: String, enum: ['dropin', 'pack', 'term', 'subscription', 'time-based', 'credit-based'], default: 'pack' },
    classesIncluded: { type: Number },
    creditsIncluded: { type: Number, default: 0 },
    dailyBookingLimit: { type: Number, default: 0 }, // 0 = unlimited bookings per day
    durationWeeks: { type: Number },
    durationValue: { type: Number },
    durationUnit: { type: String, enum: ['days', 'weeks', 'months'], default: 'weeks' },
    validityValue: { type: Number },
    validityUnit: { type: String, enum: ['days', 'weeks', 'months'], default: 'weeks' },
    billingCycle: { type: String, enum: ['none', 'weekly', 'monthly', 'yearly'], default: 'none' },
    sessionType: { type: String, enum: ['group', 'personal'], default: 'group' },
    validDays: { type: String, enum: ['weekday', 'weekend', 'both'], default: 'both' },
    timeSlots: [{ type: String }],
    trainerAllocation: { type: String, enum: ['random', 'fixed'], default: 'random' },
    extensionRules: {
      maxAllowedMissed: { type: Number, default: 2 },
      expiryBufferDays: { type: Number, default: 7 },
      cancellationWindow: { type: Number, default: 6 }, // hours before session
      allowFreezing: { type: Boolean, default: false }
    },
    tagline: { type: String },
    isFeatured: { type: Boolean, default: false },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trainer' },
    taxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tax' }
  },
  { timestamps: true }
);

const Plan = mongoose.model('Plan', planSchema);
export default Plan;
