import asyncHandler from 'express-async-handler';
import Attendance from '../models/Attendance.js';
import Booking from '../models/Booking.js';
import Session from '../models/Session.js';
import { verifyQrToken } from '../utils/qrToken.js';
import { resolveReadLocationId } from '../utils/locationScope.js';

export const getMyAttendance = asyncHandler(async (req, res) => {
  const attendance = await Attendance.find({ userId: req.user._id })
    .populate('childId', 'name age')
    .populate({ 
      path: 'sessionId', 
      populate: [
        { path: 'classId', select: 'title' },
        { path: 'trainerId', select: 'name' }
      ] 
    })
    .sort({ createdAt: -1 });
  res.json(attendance);
});

export const getAllAttendance = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const attendance = await Attendance.find(filter)
    .populate('userId', 'name email')
    .populate('childId', 'name age')
    .populate({ 
      path: 'sessionId', 
      populate: [
        { path: 'classId', select: 'title' },
        { path: 'trainerId', select: 'name' }
      ] 
    })
    .sort({ createdAt: -1 });
  res.json(attendance);
});

export const checkIn = asyncHandler(async (req, res) => {
  const { bookingId, sessionId, childId, participantName, status, method } = req.body;

  let resolvedSessionId = sessionId;
  let resolvedChildId = childId || null;
  let resolvedName = participantName || null;
  let resolvedUserId = req.user?._id || null;
  let resolvedLocationId = null;

  if (bookingId) {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      res.status(404);
      throw new Error('Booking not found');
    }
    resolvedSessionId = booking.sessionId;
    resolvedLocationId = booking.locationId;

    // If we're looking for a specific child but no childId provided, 
    // we assume the first participant or similar, but the frontend should provide the name.
  }

  if (!resolvedSessionId || (!resolvedChildId && !resolvedName)) {
    res.status(400);
    throw new Error('sessionId and either childId or participantName are required');
  }

  if (!resolvedLocationId) {
    const session = await Session.findById(resolvedSessionId);
    resolvedLocationId = session?.locationId || null;
  }

  // Filter for uniqueness
  const filter = { sessionId: resolvedSessionId };
  if (resolvedChildId) filter.childId = resolvedChildId;
  else filter.participantName = resolvedName;

  const existing = await Attendance.findOne(filter);
  if (existing) {
    existing.status = status || existing.status;
    existing.method = method || existing.method;
    existing.checkedInAt = new Date();
    const saved = await existing.save();

    // Sync session status
    if (status) {
      await Session.findByIdAndUpdate(resolvedSessionId, { attendanceStatus: status });
    }
    
    return res.json(saved);
  }

  const created = await Attendance.create({
    bookingId,
    sessionId: resolvedSessionId,
    childId: resolvedChildId,
    participantName: resolvedName,
    userId: resolvedUserId,
    status,
    method,
    locationId: resolvedLocationId
  });

  // Sync session status
  if (status) {
    await Session.findByIdAndUpdate(resolvedSessionId, { attendanceStatus: status });
  }

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

    // Sync session status
    if (status) {
       await Session.findByIdAndUpdate(payload.sessionId, { attendanceStatus: status });
    }

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

  // Sync session status
  if (status || true) {
     await Session.findByIdAndUpdate(payload.sessionId, { attendanceStatus: status || 'present' });
  }

  res.status(201).json(created);
});
