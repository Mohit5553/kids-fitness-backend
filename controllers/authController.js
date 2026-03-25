import asyncHandler from 'express-async-handler';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Trainer from '../models/Trainer.js';
import { resolveWriteLocationId } from '../utils/locationScope.js';
import { linkUserBookings } from './bookingController.js';
import { sendWelcomeEmail } from '../utils/mailer.js';

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
    country, avatarUrl, locationId: preferredLocation,
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

  const locationId = preferredLocation || resolveWriteLocationId(req);

  const user = await User.create({ 
    name, 
    firstName, 
    lastName, 
    email, 
    phone, 
    password: hashed, 
    locationId,
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
          locationId
        });
      }
    }
  }

  // Link any guest bookings made with this email to the new account
  await linkUserBookings(user);

  // Send Welcome Email
  sendWelcomeEmail(user).catch(err => console.error('Welcome email failed:', err.message));

  let trainerId = null;
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
    locationId: user.locationId,
    avatarUrl: user.avatarUrl,
    trainerId,
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

  // Ensure any guest bookings made with this email are linked
  await linkUserBookings(user);

  let trainerId = null;
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
    locationId: user.locationId,
    trainerId,
    token: generateToken(user._id)
  });
});

export const getMe = asyncHandler(async (req, res) => {
  res.json(req.user);
});
