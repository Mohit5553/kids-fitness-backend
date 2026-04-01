import asyncHandler from 'express-async-handler';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Trainer from '../models/Trainer.js';
import Role from '../models/Role.js';
import Child from '../models/Child.js';
import { resolveWriteLocationId } from '../utils/locationScope.js';
import { linkUserBookings } from './bookingController.js';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../utils/mailer.js';
import crypto from 'crypto';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

export const registerUser = asyncHandler(async (req, res) => {
  const {
    name, email, phone, password,
    firstName, lastName, instagram, gender,
    relationship, birthDate, address, city,
    country, avatarUrl, locationIds: preferredLocationIds,
    children // Array of child objects
  } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error('Name, email, and password are required');
  }

  const existing = await User.findOne({ email });
  if (existing) {
    res.status(400);
    throw new Error('User already exists');
  }

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(password, salt);

  const locationIds = preferredLocationIds || [resolveWriteLocationId(req)].filter(Boolean);

  const user = await User.create({
    name,
    firstName,
    lastName,
    email,
    phone,
    password: hashed,
    locationIds,
    instagram,
    gender,
    relationship,
    birthDate,
    address,
    city,
    country,
    avatarUrl,
    role: 'customer' // Force customer role for public registration
  });

  // Create children if provided
  if (children && Array.isArray(children)) {
    for (const childData of children) {
      if (childData.firstName) {
        const age = childData.age || (childData.birthDate ? Math.floor((new Date() - new Date(childData.birthDate)) / (365.25 * 24 * 60 * 60 * 1000)) : 0);
        await Child.create({
          parentId: user._id,
          name: `${childData.firstName} ${childData.lastName || ''}`.trim(),
          firstName: childData.firstName,
          lastName: childData.lastName,
          birthDate: childData.birthDate,
          age: age,
          gender: childData.gender || 'other',
          photoUrl: childData.photoUrl,
          school: childData.school,
          medicalCondition: childData.medicalCondition,
          locationId: locationIds[0]
        });
      }
    }
  }

  // Link any guest bookings made with this email to the new account
  await linkUserBookings(user);

  // Send Welcome Email
  sendWelcomeEmail(user).catch(err => console.error('Welcome email failed:', err.message));

  let trainerId = null;
  let permissions = [];
  if (user.role === 'superadmin') {
    permissions = ['*'];
  } else {
    const roleDoc = await Role.findOne({ name: { $regex: new RegExp(`^${user.role}$`, 'i') }, status: 'active' });
    permissions = roleDoc ? roleDoc.permissions || [] : [];
  }

  if (user.role === 'trainer') {
    const trainerProfile = await Trainer.findOne({ userId: user._id });
    trainerId = trainerProfile?._id;
  }

  res.status(201).json({
    _id: user._id,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    locationIds: user.locationIds,
    avatarUrl: user.avatarUrl,
    trainerId,
    permissions,
    token: generateToken(user._id)
  });
});

export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password are required');
  }

  const user = await User.findOne({ email });
  if (!user) {
    res.status(401);
    throw new Error('Invalid credentials');
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    res.status(401);
    throw new Error('Invalid credentials');
  }

  // Check Account Status
  if (user.status === 'inactive') {
    res.status(401);
    throw new Error('This account has been deactivated. Please contact support.');
  }

  // Ensure any guest bookings made with this email are linked
  await linkUserBookings(user);

  let trainerId = null;
  let permissions = [];
  if (user.role === 'superadmin') {
    permissions = ['*'];
  } else {
    const roleDoc = await Role.findOne({ name: { $regex: new RegExp(`^${user.role}$`, 'i') }, status: 'active' });
    permissions = roleDoc ? roleDoc.permissions || [] : [];
  }

  if (user.role === 'trainer') {
    const trainerProfile = await Trainer.findOne({ userId: user._id });
    trainerId = trainerProfile?._id;
  }

  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    locationIds: user.locationIds,
    trainerId,
    permissions,
    token: generateToken(user._id)
  });
});

export const getMe = asyncHandler(async (req, res) => {
  const user = req.user.toObject ? req.user.toObject() : { ...req.user };
  let trainerId = null;
  let permissions = [];

  if (user.role === 'superadmin') {
    permissions = ['*'];
  } else {
    const roleDoc = await Role.findOne({ name: { $regex: new RegExp(`^${user.role}$`, 'i') }, status: 'active' });
    permissions = roleDoc ? roleDoc.permissions || [] : [];
  }

  if (user.role === 'trainer') {
    const trainerProfile = await Trainer.findOne({ userId: user._id });
    trainerId = trainerProfile?._id;
  }

  res.json({
    ...user,
    trainerId,
    permissions
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    // For security, don't reveal if user exists. Just say "If an account exists..."
    return res.status(200).json({ message: 'If an account exists for that email, a reset link has been sent.' });
  }

  // Create reset token
  const resetToken = crypto.randomBytes(20).toString('hex');

  // Hash and set to user record
  user.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Set expire (1 hour)
  user.resetPasswordExpires = Date.now() + 3600000;

  await user.save();

  // Create reset URL
  const resetUrl = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/reset-password/${resetToken}`;

  try {
    const sent = await sendPasswordResetEmail(user, resetUrl);
    if (!sent) {
       user.resetPasswordToken = undefined;
       user.resetPasswordExpires = undefined;
       await user.save();
       res.status(500);
       throw new Error('Email could not be sent');
    }

    res.status(200).json({ message: 'Password reset link sent to email' });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.status(500);
    throw new Error('Email could not be sent');
  }
});

export const resetPassword = asyncHandler(async (req, res) => {
  // Hash token from params to compare with hashed token in DB
  const resetPasswordToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    resetPasswordToken,
    resetPasswordExpires: { $gt: Date.now() }
  });

  if (!user) {
    res.status(400);
    throw new Error('Invalid or expired reset token');
  }

  // Set new password
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(req.body.password, salt);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;

  await user.save();

  res.status(200).json({
    message: 'Password reset successful. You can now log in.'
  });
});
