import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Role name is required'],
    unique: true,
    trim: true
  },
  permissions: [{
    type: String // format: "module:action" e.g. "classes:create", "classes:view"
  }],
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  description: {
    type: String,
    trim: true
  }
}, { timestamps: true });

const Role = mongoose.model('Role', roleSchema);
export default Role;
