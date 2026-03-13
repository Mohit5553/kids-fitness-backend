import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    address: { type: String },
    city: { type: String },
    country: { type: String },
    phone: { type: String },
    email: { type: String },
    timezone: { type: String, default: 'Asia/Dubai' },
    imageUrl: { type: String },
    isOnline: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    sortOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const Location = mongoose.model('Location', locationSchema);
export default Location;
