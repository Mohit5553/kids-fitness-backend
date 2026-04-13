import mongoose from 'mongoose';

const PromotionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    promoType: {
      type: String,
      required: true,
      enum: ['flash', 'percentage', 'cash', 'bogo', 'bulk', 'lifestyle', 'tiered', 'cash_deposit'],
    },
    discountType: {
      type: String,
      enum: ['percentage', 'flat'],
      default: 'percentage',
    },
    discountValue: { type: Number },
    // Flash Sale details
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startTime: { type: String }, // e.g. "10:00"
    endTime: { type: String },   // e.g. "14:00"
    // BOGO details
    buyQuantity: { type: Number, default: 1 },
    getQuantity: { type: Number, default: 1 },
    buyItem: {
      itemType: { type: String, enum: ['class', 'plan'] },
      itemId: { type: mongoose.Schema.Types.ObjectId, refPath: 'buyItem.itemType' }
    },
    getItem: {
      itemType: { type: String, enum: ['class', 'plan'] },
      itemId: { type: mongoose.Schema.Types.ObjectId, refPath: 'getItem.itemType' }
    },
    // Bulk / Tiered details
    minQuantity: { type: Number },
    minOrderValue: { type: Number },
    discountTiers: [
      {
        minAmount: { type: Number },
        maxAmount: { type: Number },
        type: { type: String, enum: ['percentage', 'flat'] },
        value: { type: Number },
      }
    ],
    // Targeting
    targetGroups: [{ type: String }], // e.g. ['student', 'senior', 'parent']
    applicableLocations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
    applicableClasses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    applicablePlans: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Plan' }],
    // Audit & Control
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
    usageLimit: { type: Number }, // Total times this promo can be used
    usedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Promotion = mongoose.model('Promotion', PromotionSchema);
export default Promotion;
