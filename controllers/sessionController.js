import asyncHandler from 'express-async-handler';
import Session from '../models/Session.js';
import ClassModel from '../models/Class.js';
import Booking from '../models/Booking.js';
import { signQrToken } from '../utils/qrToken.js';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

export const getSessions = asyncHandler(async (req, res) => {
  const { start, end, classId, trainerId, locationId: queryLocationId } = req.query;
  const filter = {};

  const locationId = queryLocationId || resolveReadLocationId(req);
  if (locationId) {
    filter.locationId = locationId;
  }

  if (start || end) {
    filter.startTime = {};
    if (start) {
      filter.startTime.$gte = new Date(start);
    }
    if (end) {
      filter.startTime.$lte = new Date(end);
    }
  }

  if (classId) filter.classId = classId;
  if (trainerId) filter.trainerId = trainerId;

  const sessions = await Session.find(filter)
    .populate('classId', 'title ageGroup duration price')
    .populate('trainerId', 'name')
    .sort({ createdAt: -1 });

  // Add bookingsCount to each session
  const sessionsWithCounts = await Promise.all(
    sessions.map(async (session) => {
      const bookingsCount = await Booking.countDocuments({
        sessionId: session._id,
        status: { $ne: 'cancelled' }
      });
      return {
        ...session.toObject(),
        bookingsCount
      };
    })
  );

  res.json(sessionsWithCounts);
});

export const getSessionById = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { _id: req.params.id, locationId } : { _id: req.params.id };
  const session = await Session.findOne(filter)
    .populate('classId', 'title ageGroup duration price')
    .populate('trainerId', 'name');
  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }
  res.json(session);
});

export const createSession = asyncHandler(async (req, res) => {
  const { classId, trainerId, startTime, endTime, capacity, location, status } = req.body;
  if (!classId || !startTime) {
    res.status(400);
    throw new Error('classId and startTime are required');
  }

  const classItem = await ClassModel.findById(classId);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }

  const locationId = resolveWriteLocationId(req) || classItem.locationId;
  if (!locationId) {
    res.status(400);
    throw new Error('Location is required');
  }

  const created = await Session.create({
    classId,
    trainerId,
    startTime,
    endTime,
    capacity: capacity ?? classItem.capacity,
    location,
    status,
    locationId
  });
  res.status(201).json(created);
});

export const updateSession = asyncHandler(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && session.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  Object.assign(session, req.body);
  const saved = await session.save();
  res.json(saved);
});

export const deleteSession = asyncHandler(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && session.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  await session.deleteOne();
  res.json({ message: 'Session removed' });
});

export const getSessionQr = asyncHandler(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }
  const token = signQrToken({ sessionId: session._id, locationId: session.locationId });
  res.json({ token });
});
