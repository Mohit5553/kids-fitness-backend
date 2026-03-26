import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String },
    password: { type: String, required: true },
    role: { type: String, default: 'parent' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    instagram: { type: String },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    relationship: { type: String },
    birthDate: { type: Date },
    address: { type: String },
    city: { type: String },
    country: { type: String, default: 'United Arab Emirates' },
    avatarUrl: { type: String },
    points: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);
export default User;
