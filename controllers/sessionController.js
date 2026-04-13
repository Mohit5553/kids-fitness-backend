import asyncHandler from 'express-async-handler';
import Session from '../models/Session.js';
import ClassModel from '../models/Class.js';
import Booking from '../models/Booking.js';
import mongoose from 'mongoose';
import { signQrToken } from '../utils/qrToken.js';
import { resolveReadLocationId, resolveReadLocationIds, resolveWriteLocationId } from '../utils/locationScope.js';

// @desc    Get all sessions with filters
// @route   GET /api/sessions
// @access  Private
export const getSessions = asyncHandler(async (req, res) => {
  const { start, end, classId, trainerId, locationId: queryLocationId, trainerName, trainerEmail, all, includeMemberships } = req.query;
  const filter = {};

  if (!all) {
    filter.status = 'scheduled';
  }

  // Visibility Logic: If we're searching for a specific trainer, we skip the location filter 
  // so they can see all their assigned work. Otherwise, we restrict by location.
  const isTrainerSpecificSearch = trainerId || trainerEmail || trainerName;

  if (queryLocationId) {
    filter.locationId = queryLocationId;
  } else if (!isTrainerSpecificSearch) {
    const locationIds = resolveReadLocationIds(req);
    if (locationIds && locationIds.length > 0) {
      filter.locationId = { $in: locationIds };
    }
  }

  // Visibility Logic: Hide member-specific slots from public view/parents/admins on main schedule
  // Only show them if includeMemberships=true is passed (used in admin management pages)
  const isStaff = req.user && req.user.role !== 'parent';

  if (!(includeMemberships === 'true' && isStaff)) {
    filter.membershipId = null; 
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
  
  if (trainerId) {
    filter.trainerId = trainerId;
  } else if (trainerEmail) {
    // Robust fallback: verify the trainer's session list by their unique email ID
    const userMatched = await mongoose.model('User').findOne({ email: trainerEmail });
    if (userMatched) {
      const trainerMatched = await mongoose.model('Trainer').findOne({ userId: userMatched._id });
      if (trainerMatched) {
        filter.trainerId = trainerMatched._id;
      }
    }
  } else if (trainerName) {
    // Secondary fallback: Name-based fuzzy search
    const trainers = await mongoose.model('Trainer').find({ name: { $regex: new RegExp(trainerName, 'i') } });
    if (trainers.length > 0) {
      filter.trainerId = { $in: trainers.map(t => t._id) };
    }
  }

  const sessions = await Session.find(filter)
    .populate('classId', 'title ageGroup duration price minAge maxAge')
    .populate('trainerId', 'name')
    .populate('locationId', 'name')
    .populate({ path: 'membershipId', populate: { path: 'childId', select: 'name' } })
    .sort({ startTime: 1 }); // Sort by soonest first to ensure tomorrow/today appear at the top

  // Add bookingsCount to each session
  const sessionsWithCounts = await Promise.all(
    sessions.map(async (session) => {
      // If the session is directly linked to a membership, it counts as 1 registration
      let totalBookings = await Booking.countDocuments({
        sessionId: session._id,
        status: { $ne: 'cancelled' }
      });

      if (session.membershipId) {
          totalBookings += 1;
      }

      const sessionObj = session.toObject();
      sessionObj.bookedParticipants = totalBookings;

      // Robust fallback: if trainer is TBA but session is from a membership with a fixed trainer
      if (!sessionObj.trainerId && session.membershipId) {
          const Membership = mongoose.model('Membership');
          const Plan = mongoose.model('Plan');
          const m = await Membership.findById(session.membershipId);
          if (m) {
              const p = await Plan.findById(m.planId).populate('trainerId', 'name');
              if (p && p.trainerId && p.trainerAllocation === 'fixed') {
                  sessionObj.trainerId = p.trainerId;
                  sessionObj.trainerStatus = 'accepted';
              }
          }
      }

      return sessionObj;
    })
);

  res.json(sessionsWithCounts);
});

// @desc    Get session by ID
// @route   GET /api/sessions/:id
// @access  Private
export const getSessionById = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { _id: req.params.id, locationId } : { _id: req.params.id };
  const session = await Session.findOne(filter)
    .populate('classId', 'title ageGroup duration price minAge maxAge')
    .populate('trainerId', 'name')
    .populate('locationId', 'name')
    .populate({ path: 'membershipId', populate: { path: 'childId', select: 'name' } });
    
  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }

  // Consistent Visibility Logic
  const isStaff = req.user && req.user.role !== 'parent';

  if (session.membershipId && !isStaff) {
    res.status(403);
    throw new Error('Not authorized to view this private session');
  }

  // Add live bookedParticipants count
  const totalBookings = await Booking.countDocuments({
    sessionId: session._id,
    status: { $ne: 'cancelled' }
  });

  const sessionObj = session.toObject();
  sessionObj.bookedParticipants = totalBookings;

  res.json(sessionObj);
});

const checkTrainerConflict = async (res, trainerId, startTime, endTime, sessionId = null) => {
  if (!trainerId || !startTime || !endTime) return;

  const query = {
    trainerId,
    status: 'scheduled',
    $or: [
      { startTime: { $lt: endTime, $gte: startTime } }, // starts during
      { endTime: { $gt: startTime, $lte: endTime } },  // ends during
      { startTime: { $lte: startTime }, endTime: { $gte: endTime } } // spans over
    ]
  };

  if (sessionId) {
    query._id = { $ne: sessionId };
  }

  const conflict = await Session.findOne(query).populate('classId', 'title');
  if (conflict) {
    if (res) res.status(400);
    const timeStr = `${new Date(conflict.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(conflict.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    throw new Error(`Trainer is already assigned to "${conflict.classId?.title || 'another session'}" at this time (${timeStr}).`);
  }
};

// @desc    Create a new session
// @route   POST /api/sessions
// @access  Private/Admin
export const createSession = asyncHandler(async (req, res) => {
  let { classId, trainerId, startTime, endTime, capacity, location, status } = req.body;
  
  if (!classId || !startTime) {
    res.status(400);
    throw new Error('classId and startTime are required');
  }

  const classItem = await ClassModel.findById(classId);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }

  const start = new Date(startTime);
  let end = endTime ? new Date(endTime) : null;

  if (!end && classItem.duration) {
    const durationMinutes = parseInt(classItem.duration) || 60;
    end = new Date(start.getTime() + durationMinutes * 60000);
  }

  // Conflict Check
  await checkTrainerConflict(res, trainerId, start, end);

  const locationId = resolveWriteLocationId(req) || classItem.locationId;
  if (!locationId) {
    res.status(400);
    throw new Error('Location is required');
  }

  const created = await Session.create({
    classId,
    trainerId,
    startTime: start,
    endTime: end,
    capacity: capacity ?? classItem.capacity,
    location,
    status: status || 'scheduled',
    locationId
  });

  // Automatically add trainer to class's availableTrainers if they aren't there
  if (trainerId) {
    await ClassModel.findByIdAndUpdate(classId, {
      $addToSet: { availableTrainers: trainerId }
    });
  }

  res.status(201).json(created);
});

// @desc    Update session
// @route   PUT /api/sessions/:id
// @access  Private/Admin
export const updateSession = asyncHandler(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }

  const updateData = { ...req.body };
  const start = updateData.startTime ? new Date(updateData.startTime) : session.startTime;
  let end = updateData.endTime ? new Date(updateData.endTime) : session.endTime;

  if (updateData.startTime && !updateData.endTime) {
    const classItem = await ClassModel.findById(session.classId);
    if (classItem && classItem.duration) {
      const durationMinutes = parseInt(classItem.duration) || 60;
      end = new Date(start.getTime() + durationMinutes * 60000);
      updateData.endTime = end;
    }
  }

  // Conflict Check
  if (updateData.trainerId || updateData.startTime || updateData.endTime) {
    await checkTrainerConflict(res, updateData.trainerId || session.trainerId, start, end, session._id);
  }

  // If trainer was updated, reset trainerStatus to pending
  if (updateData.trainerId && updateData.trainerId !== session.trainerId?.toString()) {
    session.trainerStatus = 'pending';
  }

  Object.assign(session, updateData);
  const saved = await session.save();

  // If trainer was updated, add to class's availableTrainers
  if (updateData.trainerId) {
    await ClassModel.findByIdAndUpdate(session.classId, {
      $addToSet: { availableTrainers: updateData.trainerId }
    });
  }

  res.json(saved);
});

// @desc    Cancel/Restore session
// @route   DELETE /api/sessions/:id
// @access  Private
export const deleteSession = asyncHandler(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }

  // Permission Check: Admin or the Trainer assigned to the session
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
  let isAssignedTrainer = false;
  
  if (req.user.role === 'trainer') {
    const trainer = await mongoose.model('Trainer').findOne({ userId: req.user._id });
    if (trainer && session.trainerId && session.trainerId.toString() === trainer._id.toString()) {
      isAssignedTrainer = true;
    }
  }

  if (!isAdmin && !isAssignedTrainer) {
    res.status(403);
    throw new Error('Not authorized to cancel this session');
  }

  const { reason } = req.body;

  // Toggle status instead of deleting
  if (session.status === 'scheduled') {
    // Attempting to cancel
    session.status = 'cancelled';
    session.cancellationReason = reason || 'No reason provided';
    session.cancelledBy = req.user._id;
    session.cancelledAt = new Date();

    // Sync status to related bookings
    const BookingModel = mongoose.model('Booking');
    await BookingModel.updateMany(
      { sessionId: session._id, status: { $in: ['confirmed', 'pending', 'attended'] } },
      { 
        $set: { 
          status: 'cancelled', 
          cancellationReason: `Session cancelled: ${session.cancellationReason}` 
        } 
      }
    );
  } else {
    // Attempting to restore
    // Handle restoration safety (optional capacity check if logic requires it)
    session.status = 'scheduled';
    session.cancellationReason = undefined;
    session.cancelledBy = undefined;
    session.cancelledAt = undefined;
  }
  
  const saved = await session.save();
  res.json({ 
    message: `Session status updated to ${saved.status}`, 
    status: saved.status,
    cancellationReason: saved.cancellationReason 
  });
});

// @desc    Get Session QR Token
// @route   GET /api/sessions/:id/qr
// @access  Private/Admin
export const getSessionQr = asyncHandler(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }
  const token = signQrToken({ sessionId: session._id, locationId: session.locationId });
  res.json({ token });
});

// @desc    Update trainer acceptance status
// @route   PUT /api/sessions/:id/trainer-status
// @access  Private
export const updateTrainerStatus = asyncHandler(async (req, res) => {
  const { trainerStatus } = req.body;
  if (!['pending', 'accepted', 'rejected'].includes(trainerStatus)) {
    res.status(400);
    throw new Error('Invalid trainer status');
  }

  const session = await Session.findById(req.params.id);
  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }

  // Permission Check: Admin or the Trainer assigned to the session
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
  let isAssignedTrainer = false;

  const TrainerModel = mongoose.model('Trainer');
  const trainer = await TrainerModel.findOne({ userId: req.user._id });
  
  if (trainer && session.trainerId && session.trainerId.toString() === trainer._id.toString()) {
    isAssignedTrainer = true;
  }

  if (!isAdmin && !isAssignedTrainer) {
    res.status(403);
    throw new Error('Not authorized to update trainer status for this session');
  }

  session.trainerStatus = trainerStatus;
  const saved = await session.save();

  res.json(saved);
});

// @desc    Bulk create sessions
// @route   POST /api/sessions/bulk
// @access  Private/Admin
export const bulkCreateSessions = asyncHandler(async (req, res) => {
  const { sessions: sessionsData } = req.body;
  if (!sessionsData || !Array.isArray(sessionsData)) {
    res.status(400);
    throw new Error('An array of sessions is required');
  }

  const results = [];
  for (const sessionData of sessionsData) {
    try {
      const { classId, trainerId, startTime, endTime, capacity, location, locationId: bodyLocationId } = sessionData;

      if (!classId || !startTime) {
        throw new Error('classId and startTime are required');
      }

      const classItem = await ClassModel.findById(classId);
      if (!classItem) {
        throw new Error(`Class ${classId} not found`);
      }

      const start = new Date(startTime);
      let end = endTime ? new Date(endTime) : null;

      if (!end && classItem.duration) {
        const durationMinutes = parseInt(classItem.duration) || 60;
        end = new Date(start.getTime() + durationMinutes * 60000);
      }

      // Conflict Check
      if (trainerId) {
        const query = {
          trainerId,
          status: 'scheduled',
          $or: [
            { startTime: { $lt: end, $gte: start } },
            { endTime: { $gt: start, $lte: end } },
            { startTime: { $lte: start }, endTime: { $gte: end } }
          ]
        };
        const conflict = await Session.findOne(query).populate('classId', 'title');
        if (conflict) {
          throw new Error(`Trainer conflict: "${conflict.classId?.title || 'Another session'}"`);
        }
      }

      const locationId = bodyLocationId || resolveWriteLocationId(req) || classItem.locationId;
      if (!locationId) {
        throw new Error('Location is required');
      }

      const created = await Session.create({
        classId,
        trainerId,
        startTime: start,
        endTime: end,
        capacity: capacity ?? classItem.capacity,
        location,
        status: 'scheduled',
        locationId
      });

      if (trainerId) {
        await ClassModel.findByIdAndUpdate(classId, {
          $addToSet: { availableTrainers: trainerId }
        });
      }

      results.push({ success: true, session: created });
    } catch (error) {
      results.push({ success: false, error: error.message, data: sessionData });
    }
  }

  const successCount = results.filter(r => r.success).length;
  res.status(201).json({
    message: `${successCount} out of ${sessionsData.length} sessions created.`,
    results
  });
});
