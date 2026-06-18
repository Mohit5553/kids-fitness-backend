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
    expectedOnline: { type: Number, default: 0 },
    actualCash: { type: Number, default: 0 },
    discrepancy: { type: Number, default: 0 },
    notes: { type: String }
  },
  { timestamps: true }
);

const Shift = mongoose.model('Shift', shiftSchema);
export default Shift;
