import mongoose from 'mongoose';

const membershipSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    status: { type: String, enum: ['active', 'cancelled', 'expired'], default: 'active' },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    autoRenew: { type: Boolean, default: false },
    classesRemaining: { type: Number },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    notes: { type: String },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' }
  },
  { timestamps: true }
);

const Membership = mongoose.model('Membership', membershipSchema);
export default Membership;
