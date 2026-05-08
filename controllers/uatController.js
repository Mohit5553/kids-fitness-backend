import asyncHandler from 'express-async-handler';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js';
import Invoice from '../models/Invoice.js';
import Membership from '../models/Membership.js';
import Session from '../models/Session.js';
import Attendance from '../models/Attendance.js';
import ClassModel from '../models/Class.js';
import Plan from '../models/Plan.js';
import Promotion from '../models/Promotion.js';
import mongoose from 'mongoose';

/**
 * @desc    Clear all transactional UAT data
 * @route   DELETE /api/uat/clear-transactions
 * @access  Private/Superadmin
 */
export const clearUATTransactions = asyncHandler(async (req, res) => {
  const filter = { isUAT: true };

  // Models to wipe (Transactional only)
  const results = {
    bookings: await Booking.deleteMany(filter),
    payments: await Payment.deleteMany(filter),
    invoices: await Invoice.deleteMany(filter),
    memberships: await Membership.deleteMany(filter),
    sessions: await Session.deleteMany(filter),
    attendance: await Attendance.deleteMany(filter)
  };

  res.json({
    message: 'UAT Transactional data cleared successfully',
    details: results
  });
});

/**
 * @desc    Promote a specific configuration to Live
 * @route   POST /api/uat/promote
 * @access  Private/Superadmin
 */
export const promoteToLive = asyncHandler(async (req, res) => {
  const { type, id } = req.body;

  if (!type || !id) {
    res.status(400);
    throw new Error('Type and ID are required for promotion');
  }

  let model;
  switch (type.toLowerCase()) {
    case 'class': model = ClassModel; break;
    case 'plan': model = Plan; break;
    case 'promotion': model = Promotion; break;
    default:
      res.status(400);
      throw new Error('Invalid promotion type. Allowed: class, plan, promotion');
  }

  const item = await model.findById(id);
  if (!item) {
    res.status(404);
    throw new Error(`${type} not found`);
  }

  if (!item.isUAT) {
    return res.json({ message: 'Item is already in Live mode', item });
  }

  item.isUAT = false;
  await item.save();

  res.json({
    message: `${type} promoted to Live environment successfully`,
    item
  });
});

/**
 * @desc    Discard/Delete a UAT configuration
 * @route   DELETE /api/uat/discard
 * @access  Private/Superadmin
 */
export const discardUATConfig = asyncHandler(async (req, res) => {
  const { type, id } = req.body;

  if (!type || !id) {
    res.status(400);
    throw new Error('Type and ID are required for discarding');
  }

  let model;
  switch (type.toLowerCase()) {
    case 'class': model = ClassModel; break;
    case 'plan': model = Plan; break;
    case 'promotion': model = Promotion; break;
    default:
      res.status(400);
      throw new Error('Invalid type. Allowed: class, plan, promotion');
  }

  const item = await model.findById(id);
  if (!item) {
    res.status(404);
    throw new Error(`${type} not found`);
  }

  if (!item.isUAT) {
    res.status(400);
    throw new Error('Cannot discard Live data from UAT tools. Please use standard management pages.');
  }

  await model.findByIdAndDelete(id);

  res.json({
    message: `${type} discarded successfully`
  });
});

/**
 * @desc    Sync Old Data (Heal database by tagging old records as Live)
 * @route   POST /api/uat/sync-old-data
 * @access  Private/Superadmin
 */
export const syncOldData = asyncHandler(async (req, res) => {
  const filter = { isUAT: { $exists: false } };
  const update = { $set: { isUAT: false } };

  const results = {
    bookings: await Booking.updateMany(filter, update),
    payments: await Payment.updateMany(filter, update),
    invoices: await Invoice.updateMany(filter, update),
    memberships: await Membership.updateMany(filter, update),
    sessions: await Session.updateMany(filter, update),
    classes: await ClassModel.updateMany(filter, update),
    plans: await Plan.updateMany(filter, update),
    promotions: await Promotion.updateMany(filter, update)
  };

  res.json({
    message: 'Database synced successfully. All old records are now officially tagged as Live.',
    details: results
  });
});

/**
 * @desc    Get all UAT configurations (for promotion list)
 * @route   GET /api/uat/configs
 * @access  Private/Superadmin
 */
export const getUATConfigs = asyncHandler(async (req, res) => {
  const filter = { isUAT: true };

  const configs = {
    classes: await ClassModel.find(filter).select('title price locationId createdAt'),
    plans: await Plan.find(filter).select('name price type locationId createdAt'),
    promotions: await Promotion.find(filter).select('name code discountAmount createdAt')
  };

  res.json(configs);
});
