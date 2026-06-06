import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    type: { type: String, enum: ['class', 'membership', 'both'], default: 'both' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    isUAT: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

const Category = mongoose.model('Category', categorySchema);
export default Category;
