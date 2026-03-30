import asyncHandler from 'express-async-handler';
import ClassModel from '../models/Class.js';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

export const getClasses = asyncHandler(async (req, res) => {
  const { locationId: queryLocationId } = req.query;
  const locationId = queryLocationId || resolveReadLocationId(req);
  const filter = (locationId && locationId !== 'all') ? { locationId } : {};
  const classes = await ClassModel.find(filter)
    .populate('availableTrainers', 'name status locationIds bio specialties avatarUrl gallery')
    .sort({ createdAt: -1 });
  res.json(classes);
});

export const getClassById = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { _id: req.params.id, locationId } : { _id: req.params.id };
  const classItem = await ClassModel.findOne(filter).populate('availableTrainers', 'name status locationIds bio specialties avatarUrl gallery');
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }
  res.json(classItem);
});

export const createClass = asyncHandler(async (req, res) => {
  const { title, description, ageGroup, duration, availableTrainers, price, capacity } = req.body;
  if (!title || price == null) {
    res.status(400);
    throw new Error('Title and price are required');
  }
  const locationId = resolveWriteLocationId(req);
  if (!locationId) {
    res.status(400);
    throw new Error('Location is required');
  }
  const created = await ClassModel.create({
    title,
    description,
    ageGroup,
    duration,
    availableTrainers,
    price,
    capacity,
    locationId
  });
  res.status(201).json(created);
});

export const updateClass = asyncHandler(async (req, res) => {
  const classItem = await ClassModel.findById(req.params.id);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && classItem.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  Object.assign(classItem, req.body);
  const saved = await classItem.save();
  res.json(saved);
});

export const deleteClass = asyncHandler(async (req, res) => {
  const classItem = await ClassModel.findById(req.params.id);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && classItem.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  await classItem.deleteOne();
  res.json({ message: 'Class removed' });
});
