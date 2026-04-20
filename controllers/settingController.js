import asyncHandler from 'express-async-handler';
import Counter from '../models/Counter.js';
import Setting from '../models/Setting.js';

// @desc    Get all system sequence counters
// @route   GET /api/settings/counters
// @access  Private/Admin
export const getCounters = asyncHandler(async (req, res) => {
  const counters = await Counter.find({});
  res.json(counters);
});

// @desc    Update a specific sequence counter
// @route   PUT /api/settings/counters/:name
// @access  Private/Admin
export const updateCounter = asyncHandler(async (req, res) => {
  const { name } = req.params;
  const { seq } = req.body;

  if (seq === undefined || isNaN(seq)) {
    res.status(400);
    throw new Error('Valid sequence number is required');
  }

  const result = await Counter.findOneAndUpdate(
    { name },
    { $set: { seq: Number(seq) } },
    { new: true, upsert: true }
  );

  res.json(result);
});

// @desc    Get all global settings
// @route   GET /api/settings/global
// @access  Public (filtered) or Private/Admin
export const getGlobalSettings = asyncHandler(async (req, res) => {
  const settings = await Setting.find({});
  res.json(settings);
});

// @desc    Update a global setting
// @route   PUT /api/settings/global/:key
// @access  Private/Admin
export const updateGlobalSetting = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { value, description } = req.body;

  const setting = await Setting.findOneAndUpdate(
    { key },
    { $set: { value, description } },
    { new: true, upsert: true }
  );

  res.json(setting);
});
