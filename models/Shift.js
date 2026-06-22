import mongoose from 'mongoose';

const shiftSchema = new mongoose.Schema(
  {
    cashierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    openedAt: { type: Date, required: true },
    closedAt: { type: Date },
    startingCash: { type: Number, required: true, default: 0 },
    expectedCash: { type: Number, default: 0 },
    expectedCard: { type: Number, default: 0 },
    expectedVisa: { type: Number, default: 0 },
    expectedMastercard: { type: Number, default: 0 },
    expectedOnline: { type: Number, default: 0 },
    actualCash: { type: Number, default: 0 },
    actualVisa: { type: Number, default: 0 },
    actualMastercard: { type: Number, default: 0 },
    discrepancy: { type: Number, default: 0 },
    openingDenominations: { type: Object },
    closingDenominations: { type: Object },
    notes: { type: String }
  },
  { timestamps: true }
);

const Shift = mongoose.model('Shift', shiftSchema);
export default Shift;
