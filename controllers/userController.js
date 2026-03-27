import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import Child from '../models/Child.js';
import { resolveReadLocationId } from '../utils/locationScope.js';
import { sendAccountUpdateEmail } from '../utils/mailer.js';
import bcrypt from 'bcryptjs';

export const getUsers = asyncHandler(async (req, res) => {
  const isAdminOrSuper = req.user.role === 'superadmin' || req.user.role === 'admin';
  const locationId = resolveReadLocationId(req);

  // Admins and Superadmins see all users. Others (if any staff) see their branch.
  const filter = (isAdminOrSuper || req.query.all === 'true' || !locationId) ? {} : { $or: [{ locationIds: locationId }, { locationId: locationId }] };

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

export const updateUserRole = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  if (req.body.role) {
    user.role = req.body.role;
  }
  if (req.user?.role === 'superadmin' && req.body.locationIds !== undefined) {
    user.locationIds = req.body.locationIds || [];
  }
  const saved = await user.save();

  // Notify User of account changes
  sendAccountUpdateEmail(saved, 'account permissions/role').catch(err => console.error('Account update email failed:', err.message));

  res.json({ _id: saved._id, role: saved.role, locationIds: saved.locationIds });
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
