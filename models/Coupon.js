import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema(
  {
    code: { 
      type: String, 
      required: true, 
      unique: true, 
      uppercase: true,
      trim: true 
    },
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User'
    },
    type: {
      type: String,
      enum: ['gift', 'promo', 'cash_deposit', 'referral'],
      default: 'gift'
    },
    description: {
      type: String
    },
    amount: { 
      type: Number, 
      required: true 
    },
    expiryDate: { 
      type: Date, 
      required: true 
    },
    status: { 
      type: String, 
      enum: ['active', 'redeemed', 'expired'], 
      default: 'active' 
    },
    sourceBookingId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Booking' 
    },
    redeemBookingId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Booking' 
    },
    redeemedAt: { 
      type: Date 
    }
  },
  { timestamps: true }
);

// Middleware to check expiry on find
couponSchema.pre('find', function() {
  const now = new Date();
  // This is a soft check, doesn't update the DB but could be used in controller
});

const Coupon = mongoose.model('Coupon', couponSchema);
export default Coupon;
