import asyncHandler from 'express-async-handler';
import Counter from '../models/Counter.js';

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
