import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Expense title is required'],
    trim: true
  },
  category: {
    type: String,
    enum: ['Salary', 'Equipment', 'Maintenance', 'Utilities', 'Marketing', 'Other'],
    required: [true, 'Category is required']
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  currency: {
    type: String,
    default: 'AED'
  },
  date: {
    type: Date,
    default: Date.now,
    required: [true, 'Expense date is required']
  },
  locationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Location',
    required: false // If company-wide, might be null. But usually tied to a branch
  },
  receiptUrl: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isUat: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

const Expense = mongoose.model('Expense', expenseSchema);
export default Expense;
