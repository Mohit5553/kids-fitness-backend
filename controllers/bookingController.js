import asyncHandler from 'express-async-handler';
import Booking from '../models/Booking.js';
import Session from '../models/Session.js';
import ClassModel from '../models/Class.js';
import SalesOrder from '../models/SalesOrder.js';
import { resolveReadLocationId } from '../utils/locationScope.js';

export const getMyBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ userId: req.user._id })
    .populate('classId', 'title price')
    .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
    .sort({ createdAt: -1 });
  res.json(bookings);
});

export const getAllBookings = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const bookings = await Booking.find(filter)
    .populate('userId', 'name email')
    .populate('classId', 'title price')
    .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
    .sort({ createdAt: -1 });
  res.json(bookings);
});

export const createBooking = asyncHandler(async (req, res) => {
  const { participants, classId, date, sessionId, paymentMethod, paymentStatus, guestDetails } = req.body;
  
  if (!req.user && (!guestDetails || !guestDetails.name || !guestDetails.email)) {
    res.status(400);
    throw new Error('Must be logged in or provide guest details');
  }

  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    res.status(400);
    throw new Error('Participants array is required');
  }

  if (!classId && !sessionId) {
    res.status(400);
    throw new Error('classId or sessionId is required');
  }

  let resolvedClassId = classId;
  let resolvedDate = date;
  let resolvedSessionId = sessionId;
  let resolvedLocationId = null;
  let session = null;

  if (sessionId) {
    session = await Session.findById(sessionId);
    if (!session) {
      res.status(404);
      throw new Error('Session not found');
    }
    resolvedClassId = session.classId;
    resolvedDate = session.startTime;
    resolvedLocationId = session.locationId;

    // Capacity Check
    const remainingCapacity = session.capacity - session.bookedParticipants;
    if (participants.length > remainingCapacity) {
      res.status(400);
      throw new Error(`Only ${remainingCapacity} spots remaining in this session`);
    }
  }

  const classItem = await ClassModel.findById(resolvedClassId);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }
  
  if (!resolvedLocationId) resolvedLocationId = classItem.locationId;
  if (!resolvedDate) {
    res.status(400);
    throw new Error('Date is required');
  }

  // Calculate Total Amount
  const totalAmount = (classItem.price || 0) * participants.length;

  // Age and Gender Validation
  for (const p of participants) {
    if (!p.name || !p.age || !p.gender) {
      res.status(400);
      throw new Error(`Please provide complete details for all participants`);
    }

    const pAge = Number(p.age);
    if (classItem.minAge !== undefined && classItem.minAge !== null && pAge < classItem.minAge) {
      res.status(400);
      throw new Error(`${p.name} is too young for this class. Minimum age: ${classItem.minAge}`);
    }
    if (classItem.maxAge !== undefined && classItem.maxAge !== null && pAge > classItem.maxAge) {
      res.status(400);
      throw new Error(`${p.name} is too old for this class. Maximum age: ${classItem.maxAge}`);
    }
    if (classItem.genderRestriction && classItem.genderRestriction !== 'any') {
      if (p.gender.toLowerCase() !== classItem.genderRestriction.toLowerCase()) {
        res.status(400);
        throw new Error(`${p.name}'s gender does not match the class restriction: ${classItem.genderRestriction}`);
      }
    }
  }

  const bookingData = {
    participants,
    classId: resolvedClassId,
    sessionId: resolvedSessionId,
    date: resolvedDate,
    totalAmount,
    locationId: resolvedLocationId,
    paymentMethod,
    paymentStatus
  };

  if (req.user) {
    bookingData.userId = req.user._id;
  } else {
    bookingData.guestDetails = guestDetails;
  }

  const created = await Booking.create(bookingData);

  // If paying at center, generate a SalesOrder
  if (paymentMethod === 'center') {
    const orderData = {
      bookingId: created._id,
      amount: totalAmount,
      status: 'pending',
      locationId: resolvedLocationId
    };
    if (req.user) {
      orderData.userId = req.user._id;
    } else {
      orderData.guestDetails = guestDetails;
    }
    await SalesOrder.create(orderData);
  }

  // Update session occupancy if applicable
  if (session) {
    session.bookedParticipants += participants.length;
    await session.save();
  }

  res.status(201).json(created);
});

export const updateBookingStatus = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && booking.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  booking.status = req.body.status || booking.status;
  const saved = await booking.save();
  res.json(saved);
});

export const requestRefund = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }

  if (booking.userId.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }

  if (booking.status !== 'confirmed' || booking.paymentStatus !== 'completed') {
    res.status(400);
    throw new Error('Only confirmed and paid bookings can be refunded');
  }

  if (!booking.paymentDate) {
    res.status(400);
    throw new Error('Payment date not found');
  }

  const now = new Date();
  const paymentDate = new Date(booking.paymentDate);

  // Check if it's the same day
  const isSameDay = 
    now.getFullYear() === paymentDate.getFullYear() &&
    now.getMonth() === paymentDate.getMonth() &&
    now.getDate() === paymentDate.getDate();

  if (!isSameDay) {
    res.status(400);
    throw new Error('Refund must be requested on the same day as the transaction');
  }

  // Check if it's within 1 hour
  const diffInMs = now.getTime() - paymentDate.getTime();
  const diffInHours = diffInMs / (1000 * 60 * 60);

  if (diffInHours > 1) {
    res.status(400);
    throw new Error('Refund must be requested within one hour of the transaction');
  }

  booking.refundStatus = 'requested';
  await booking.save();

  res.json({ message: 'Refund request submitted successfully' });
});

export const deleteBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }
  if (booking.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    res.status(403);
    throw new Error('Not allowed');
  }
  await booking.deleteOne();
  res.json({ message: 'Booking removed' });
});
