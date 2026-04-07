import mongoose from 'mongoose';

const extensionRequestSchema = new mongoose.Schema(
  {
    membershipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Membership', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['reschedule', 'extend'], required: true },
    reason: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    adminNotes: { type: String },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedAt: { type: Date },
    // For reschedule: which session and new date/slot
    targetSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
    newDate: { type: Date },
    newSlot: { type: String }
  },
  { timestamps: true }
);

const ExtensionRequest = mongoose.model('ExtensionRequest', extensionRequestSchema);
export default ExtensionRequest;
