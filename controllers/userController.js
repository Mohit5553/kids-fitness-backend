import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import Trainer from '../models/Trainer.js';
import Child from '../models/Child.js';
import { resolveReadLocationId } from '../utils/locationScope.js';
import { sendAccountUpdateEmail } from '../utils/mailer.js';
import bcrypt from 'bcryptjs';

const syncTrainerProfile = async (user) => {
  if (user.role === 'trainer') {
    await Trainer.findOneAndUpdate(
      { email: user.email },
      {
        name: user.name,
        email: user.email,
        phone: user.phone,
        userId: user._id,
        locationIds: user.locationIds || [],
        status: 'active'
      },
      { upsert: true, new: true }
    );
  }
};

export const getUsers = asyncHandler(async (req, res) => {
  const isAdminOrSuper = req.user.role === 'superadmin' || req.user.role === 'admin';
  const locationId = resolveReadLocationId(req);

  // Show all users regardless of branch selection in management view
  const filter = {};

  const users = await User.find(filter)
    .populate('locationIds', 'name')
    .select('-password')
    .sort({ createdAt: -1 });
  res.json(users);
});

export const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-password');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  res.json(user);
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const { name, email, phone, role, locationIds } = req.body;

  if (email && email !== user.email) {
    const existing = await User.findOne({ email });
    if (existing) {
      res.status(400);
      throw new Error('This email is already in use by another account');
    }
    user.email = email;
  }

  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (role) user.role = role;

  if (req.user?.role === 'superadmin' && locationIds !== undefined) {
    user.locationIds = locationIds || [];
  }

  const saved = await user.save();
  await syncTrainerProfile(saved).catch(err => console.error('Trainer sync failed:', err.message));

  // Notify User of account changes
  sendAccountUpdateEmail(saved, 'account details/permissions').catch(err => console.error('Account update email failed:', err.message));

  res.json({
    _id: saved._id,
    name: saved.name,
    email: saved.email,
    phone: saved.phone,
    role: saved.role,
    locationIds: saved.locationIds
  });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  await user.deleteOne();
  res.json({ message: 'User removed' });
});

export const createStaff = asyncHandler(async (req, res) => {
  const { name, email, password, role, phone, locationIds } = req.body;

  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('User already exists');
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    role,
    phone,
    locationIds: locationIds || (req.user.locationIds && req.user.locationIds.length > 0 ? [req.user.locationIds[0]] : [])
  });

  await syncTrainerProfile(user).catch(err => console.error('Trainer sync failed:', err.message));

  res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role
  });
});

export const getUserChildren = asyncHandler(async (req, res) => {
  const children = await Child.find({ parentId: req.params.id });
  res.json(children);
});
