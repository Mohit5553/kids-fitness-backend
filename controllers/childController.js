import asyncHandler from 'express-async-handler';
import Child from '../models/Child.js';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

export const getMyChildren = asyncHandler(async (req, res) => {
  const children = await Child.find({ parentId: req.user._id }).sort({ createdAt: -1 });
  res.json(children);
});

export const getAllChildren = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const children = await Child.find(filter).sort({ createdAt: -1 });
  res.json(children);
});

export const createChild = asyncHandler(async (req, res) => {
  const { name, age, gender } = req.body;
  if (!name || !age) {
    res.status(400);
    throw new Error('Name and age are required');
  }
  const locationId = resolveWriteLocationId(req);
  const created = await Child.create({ parentId: req.user._id, name, age, gender, locationId });
  res.status(201).json(created);
});

export const updateChild = asyncHandler(async (req, res) => {
  const child = await Child.findById(req.params.id);
  if (!child) {
    res.status(404);
    throw new Error('Child not found');
  }
  if (child.parentId.toString() !== req.user._id.toString() && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    res.status(403);
    throw new Error('Not allowed');
  }
  Object.assign(child, req.body);
  const saved = await child.save();
  res.json(saved);
});

export const deleteChild = asyncHandler(async (req, res) => {
  const child = await Child.findById(req.params.id);
  if (!child) {
    res.status(404);
    throw new Error('Child not found');
  }
  if (child.parentId.toString() !== req.user._id.toString() && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    res.status(403);
    throw new Error('Not allowed');
  }
  await child.deleteOne();
  res.json({ message: 'Child removed' });
});
