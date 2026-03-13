import asyncHandler from 'express-async-handler';
import Activity from '../models/Activity.js';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

export const getActivities = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { $or: [{ locationId }, { locationId: null }] } : {};
  const activities = await Activity.find(filter).sort({ name: 1 });
  res.json(activities);
});

export const getActivityById = asyncHandler(async (req, res) => {
  const activity = await Activity.findById(req.params.id);
  if (!activity) {
    res.status(404);
    throw new Error('Activity not found');
  }
  res.json(activity);
});

export const createActivity = asyncHandler(async (req, res) => {
  const { name, description, status } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }
  const locationId = resolveWriteLocationId(req);
  const created = await Activity.create({ name, description, status, locationId });
  res.status(201).json(created);
});

export const updateActivity = asyncHandler(async (req, res) => {
  const activity = await Activity.findById(req.params.id);
  if (!activity) {
    res.status(404);
    throw new Error('Activity not found');
  }
  Object.assign(activity, req.body);
  const saved = await activity.save();
  res.json(saved);
});

export const deleteActivity = asyncHandler(async (req, res) => {
  const activity = await Activity.findById(req.params.id);
  if (!activity) {
    res.status(404);
    throw new Error('Activity not found');
  }
  await activity.deleteOne();
  res.json({ message: 'Activity removed' });
});
