import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import { resolveReadLocationId } from '../utils/locationScope.js';
import { sendAccountUpdateEmail } from '../utils/mailer.js';

export const getUsers = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const users = await User.find(filter).select('-password').sort({ createdAt: -1 });
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
