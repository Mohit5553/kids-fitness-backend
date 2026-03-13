import asyncHandler from 'express-async-handler';
import Booking from '../models/Booking.js';
import Session from '../models/Session.js';
import ClassModel from '../models/Class.js';
import { resolveReadLocationId } from '../utils/locationScope.js';

export const getMyBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ userId: req.user._id })
    .populate('childId', 'name age')
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
    .populate('childId', 'name age')
    .populate('classId', 'title price')
    .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
    .sort({ createdAt: -1 });
  res.json(bookings);
});

export const createBooking = asyncHandler(async (req, res) => {
  const { childId, classId, date, sessionId } = req.body;
  if (!childId || (!classId && !sessionId)) {
    res.status(400);
    throw new Error('childId and classId or sessionId are required');
  }

  let resolvedClassId = classId;
  let resolvedDate = date;
  let resolvedSessionId = sessionId;
  let resolvedLocationId = null;

  if (sessionId) {
    const session = await Session.findById(sessionId);
    if (!session) {
      res.status(404);
      throw new Error('Session not found');
    }
    resolvedClassId = session.classId;
    resolvedDate = session.startTime;
    resolvedSessionId = session._id;
    resolvedLocationId = session.locationId;

    if (session.capacity) {
      const bookedCount = await Booking.countDocuments({ sessionId: sessionId, status: { $ne: 'cancelled' } });
      if (bookedCount >= session.capacity) {
        res.status(400);
        throw new Error('Session is full');
      }
    }
  } else {
    if (!resolvedDate) {
      res.status(400);
      throw new Error('date is required when booking without a session');
    }
    const classItem = await ClassModel.findById(resolvedClassId);
    if (!classItem) {
      res.status(404);
      throw new Error('Class not found');
    }
    resolvedLocationId = classItem.locationId;
  }

  if (!resolvedLocationId) {
    resolvedLocationId = resolveReadLocationId(req);
  }

  if (!resolvedLocationId) {
    res.status(400);
    throw new Error('Location is required');
  }

  const created = await Booking.create({
    userId: req.user._id,
    childId,
    classId: resolvedClassId,
    sessionId: resolvedSessionId,
    date: resolvedDate,
    locationId: resolvedLocationId
  });
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
