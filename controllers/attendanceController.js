import asyncHandler from 'express-async-handler';
import Attendance from '../models/Attendance.js';
import Booking from '../models/Booking.js';
import Session from '../models/Session.js';
import { verifyQrToken } from '../utils/qrToken.js';
import { resolveReadLocationId } from '../utils/locationScope.js';

export const getMyAttendance = asyncHandler(async (req, res) => {
  const attendance = await Attendance.find({ userId: req.user._id })
    .populate('childId', 'name age')
    .populate({ path: 'sessionId', populate: { path: 'classId', select: 'title' } })
    .sort({ createdAt: -1 });
  res.json(attendance);
});

export const getAllAttendance = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const attendance = await Attendance.find(filter)
    .populate('userId', 'name email')
    .populate('childId', 'name age')
    .populate({ path: 'sessionId', populate: { path: 'classId', select: 'title' } })
    .sort({ createdAt: -1 });
  res.json(attendance);
});

export const checkIn = asyncHandler(async (req, res) => {
  const { bookingId, sessionId, childId, status, method } = req.body;

  let resolvedSessionId = sessionId;
  let resolvedChildId = childId;
  let resolvedUserId = req.user._id;
  let resolvedLocationId = null;

  if (bookingId) {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      res.status(404);
      throw new Error('Booking not found');
    }
    resolvedSessionId = booking.sessionId;
    resolvedChildId = booking.childId;
    resolvedUserId = booking.userId;
    resolvedLocationId = booking.locationId;
  }

  if (!resolvedSessionId || !resolvedChildId) {
    res.status(400);
    throw new Error('sessionId and childId are required');
  }

  if (!resolvedLocationId) {
    const session = await Session.findById(resolvedSessionId);
    resolvedLocationId = session?.locationId || null;
  }

  const existing = await Attendance.findOne({ sessionId: resolvedSessionId, childId: resolvedChildId });
  if (existing) {
    existing.status = status || existing.status;
    existing.method = method || existing.method;
    existing.checkedInAt = new Date();
    const saved = await existing.save();
    return res.json(saved);
  }

  const created = await Attendance.create({
    bookingId,
    sessionId: resolvedSessionId,
    childId: resolvedChildId,
    userId: resolvedUserId,
    status,
    method,
    locationId: resolvedLocationId
  });
  res.status(201).json(created);
});

export const qrCheckIn = asyncHandler(async (req, res) => {
  const { token, childId, status } = req.body;
  if (!token || !childId) {
    res.status(400);
    throw new Error('token and childId are required');
  }

  const payload = verifyQrToken(token);
  if (!payload?.sessionId) {
    res.status(400);
    throw new Error('Invalid QR token');
  }

  const existing = await Attendance.findOne({ sessionId: payload.sessionId, childId });
  if (existing) {
    existing.status = status || existing.status;
    existing.method = 'qr';
    existing.checkedInAt = new Date();
    const saved = await existing.save();
    return res.json(saved);
  }

  const session = await Session.findById(payload.sessionId);

  const created = await Attendance.create({
    sessionId: payload.sessionId,
    childId,
    userId: payload.userId,
    status: status || 'present',
    method: 'qr',
    locationId: session?.locationId
  });

  res.status(201).json(created);
});
