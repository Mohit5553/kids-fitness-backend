import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import { resolveReadLocationId } from '../utils/locationScope.js';
import { sendAccountUpdateEmail } from '../utils/mailer.js';
import bcrypt from 'bcryptjs';

export const getUsers = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = (req.query.all === 'true' || !locationId) ? {} : { locationId };
  const users = await User.find(filter)
    .populate('locationId', 'name')
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

export const updateUserRole = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  if (req.body.role) {
    user.role = req.body.role;
  }
  if (req.user?.role === 'superadmin' && req.body.locationId !== undefined) {
    user.locationId = req.body.locationId || null;
  }
  const saved = await user.save();

  // Notify User of account changes
  sendAccountUpdateEmail(saved, 'account permissions/role').catch(err => console.error('Account update email failed:', err.message));

  res.json({ _id: saved._id, role: saved.role, locationId: saved.locationId });
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
  const { name, email, password, role, phone, locationId } = req.body;

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
    locationId: locationId || req.user.locationId
  });

  res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role
  });
});
