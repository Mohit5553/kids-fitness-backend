import asyncHandler from 'express-async-handler';
import Trainer from '../models/Trainer.js';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

const syncUserProfile = async (trainerData, password) => {
  const { name, email, phone, locationIds } = trainerData;
  let user = await User.findOne({ email });

  if (!user) {
    // Create new login account for new trainer
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password || 'Kfb@123', salt);
    user = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role: 'trainer',
      locationIds: locationIds || []
    });
  } else {
    // Update existing user to have trainer role and updated details
    user.name = name;
    user.phone = phone;
    user.role = 'trainer';
    if (locationIds) user.locationIds = locationIds;
    await user.save();
  }
  return user._id;
};

export const getTrainers = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationIds: locationId } : {};
  const trainers = await Trainer.find(filter).sort({ createdAt: -1 });
  res.json(trainers);
});

export const getTrainerById = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { _id: req.params.id, locationIds: locationId } : { _id: req.params.id };
  const trainer = await Trainer.findOne(filter);
  if (!trainer) {
    res.status(404);
    throw new Error('Trainer not found');
  }
  res.json(trainer);
});

export const createTrainer = asyncHandler(async (req, res) => {
  const { name, bio, specialties, phone, email, avatarUrl, gallery, status, locationIds: providedLocationIds, password } = req.body;
  
  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }
  
  const writeLoc = resolveWriteLocationId(req);
  const locationIds = providedLocationIds || (writeLoc ? [writeLoc] : []);

  // Sync to User collection first to get userId or link existing
  const userId = await syncUserProfile({ name, email, phone, locationIds }, password);

  const created = await Trainer.create({
    name, bio, specialties, phone, email, avatarUrl, gallery, status, locationIds, userId
  });
  res.status(201).json(created);
});

export const updateTrainer = asyncHandler(async (req, res) => {
  const trainer = await Trainer.findById(req.params.id);
  if (!trainer) {
    res.status(404);
    throw new Error('Trainer not found');
  }

  // Permission check...
  
  Object.assign(trainer, req.body);
  const saved = await trainer.save();

  // Sync updates back to User collection
  await syncUserProfile(saved, req.body.password).catch(err => console.error('User sync failed:', err.message));

  res.json(saved);
});

export const deleteTrainer = asyncHandler(async (req, res) => {
  const trainer = await Trainer.findById(req.params.id);
  if (!trainer) {
    res.status(404);
    throw new Error('Trainer not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && !trainer.locationIds?.map(id => id.toString()).includes(req.user.locationId.toString())) {
    res.status(403);
    throw new Error('Not allowed');
  }
  await trainer.deleteOne();
  res.json({ message: 'Trainer removed' });
});

