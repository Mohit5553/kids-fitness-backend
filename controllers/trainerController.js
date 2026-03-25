import asyncHandler from 'express-async-handler';
import Trainer from '../models/Trainer.js';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
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
  const { name, bio, specialties, phone, email, avatarUrl, gallery, status, password } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }
  const locationId = resolveWriteLocationId(req);
  if (!locationId) {
    res.status(400);
    throw new Error('Location is required');
  }

  let userId = null;
  if (email && password) {
    const existing = await User.findOne({ email });
    if (existing) {
      res.status(400);
      throw new Error('A user with this email already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      email,
      phone,
      password: hashed,
      role: 'trainer',
      locationId
    });
    userId = user._id;
  }

  const created = await Trainer.create({ 
    name, bio, specialties, phone, email, avatarUrl, gallery, status, locationId, userId 
  });
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

  const { password, ...otherData } = req.body;

  // Handle Password / User Account Update
  if (password) {
    if (trainer.userId) {
      // Update existing user account
      const user = await User.findById(trainer.userId);
      if (user) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        await user.save();
      }
    } else if (trainer.email) {
      // Create new user account for existing trainer
      let user = await User.findOne({ email: trainer.email });
      if (user) {
        // If user exists with same email, just link them
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        user.role = 'trainer';
        await user.save();
        trainer.userId = user._id;
      } else {
        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash(password, salt);
        user = await User.create({
          name: trainer.name,
          email: trainer.email,
          phone: trainer.phone,
          password: hashed,
          role: 'trainer',
          locationId: trainer.locationId
        });
        trainer.userId = user._id;
      }
    }
  }

  Object.assign(trainer, otherData);
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

