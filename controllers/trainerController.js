import asyncHandler from 'express-async-handler';
import Trainer from '../models/Trainer.js';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

export const getTrainers = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const trainers = await Trainer.find(filter).sort({ createdAt: -1 });
  res.json(trainers);
});

export const getTrainerById = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { _id: req.params.id, locationId } : { _id: req.params.id };
  const trainer = await Trainer.findOne(filter);
  if (!trainer) {
    res.status(404);
    throw new Error('Trainer not found');
  }
  res.json(trainer);
});

export const createTrainer = asyncHandler(async (req, res) => {
  const { name, bio, specialties, phone, email, avatarUrl, status } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }
  const locationId = resolveWriteLocationId(req);
  if (!locationId) {
    res.status(400);
    throw new Error('Location is required');
  }
  const created = await Trainer.create({ name, bio, specialties, phone, email, avatarUrl, status, locationId });
  res.status(201).json(created);
});

export const updateTrainer = asyncHandler(async (req, res) => {
  const trainer = await Trainer.findById(req.params.id);
  if (!trainer) {
    res.status(404);
    throw new Error('Trainer not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && trainer.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  Object.assign(trainer, req.body);
  const saved = await trainer.save();
  res.json(saved);
});

export const deleteTrainer = asyncHandler(async (req, res) => {
  const trainer = await Trainer.findById(req.params.id);
  if (!trainer) {
    res.status(404);
    throw new Error('Trainer not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && trainer.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  await trainer.deleteOne();
  res.json({ message: 'Trainer removed' });
});
