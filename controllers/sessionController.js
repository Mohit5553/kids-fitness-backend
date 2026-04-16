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
    if (includeMemberships === 'true') {
      filter.$or = [{ locationId: queryLocationId }, { locationId: null }, { locationId: { $exists: false } }];
    } else {
      filter.locationId = queryLocationId;
    }
  } else if (!isTrainerSpecificSearch) {
    const locationIds = resolveReadLocationIds(req);
    if (locationIds && locationIds.length > 0) {
      if (includeMemberships === 'true') {
        filter.$or = [{ locationId: { $in: locationIds } }, { locationId: null }, { locationId: { $exists: false } }];
      } else {
        filter.locationId = { $in: locationIds };
      }
    }
  }

  // Visibility Logic: Hide member-specific slots from public view/parents/admins on main schedule
  // Only show them if includeMemberships=true is passed (used in admin management pages)
  const isStaff = req.user && req.user.role !== 'parent';

  // Automatic visibility: If it's a staff member/trainer, include membership slots by default
  // if searching specifically for their schedule or if explicitly requested.
  if (!isStaff || (includeMemberships !== 'true' && !isTrainerSpecificSearch)) {
    filter.membershipId = null;
    filter.classType = 'Class'; // Force Physical Class only for public schedule
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
    // New Logic: Show sessions explicitly assigned to this trainer 
    // PLUS unassigned (Random) sessions at the trainer's authorized locations.
    const TrainerModel = mongoose.model('Trainer');
    const trainer = await TrainerModel.findById(trainerId);
    if (trainer && trainer.locationIds && trainer.locationIds.length > 0) {
      filter.$or = [
        { trainerId: trainerId },
        {
          trainerId: null,
          locationId: { $in: trainer.locationIds },
          status: 'scheduled'
        }
      ];
    } else {
      filter.trainerId = trainerId;
    }
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
    .populate({ path: 'classId', select: 'title name ageGroup duration price minAge maxAge' })
    .populate('trainerId', 'name')
    .populate('locationId', 'name')
    .sort({ startTime: 1 });

  // Add bookingsCount to each session
  const sessionsWithCounts = (await Promise.all(
    sessions.map(async (session) => {
      // Corrected Occupancy Calculation for Shared Sessions
      // 1. Resolve ALL Unique Plan names for this session (Shared Membership Packages)
      const MembershipModel = mongoose.model('Membership');
      const memberships = await MembershipModel.find({
        generatedSessions: session._id,
        status: 'active'
      }).populate('planId', 'name');

      const normalBookings = await Booking.countDocuments({
        sessionId: session._id,
        status: { $ne: 'cancelled' }
      });

      // STRICT FILTERING: 
      // Physical Classes (classType: 'Class') should only count normal bookings.
      // Membership Sessions (classType: 'Plan') should only count membership students.
      let totalOccupancy = 0;
      if (session.classType === 'Class') {
        totalOccupancy = normalBookings;
      } else {
        totalOccupancy = memberships.length;
      }

      const sessionObj = session.toObject();
      sessionObj.bookedParticipants = totalOccupancy;

      // Backward compatibility: old flows may have unassigned sessions stuck in "rejected".
      // Keep these claimable until a trainer explicitly accepts.
      if (!sessionObj.trainerId && sessionObj.trainerStatus === 'rejected') {
        sessionObj.trainerStatus = 'pending';
      }

      // Ensure session has a visible title/name
      const baseInfo = sessionObj.classId || {};
      const actualTitle = baseInfo.title || baseInfo.name;

      // STRICT FILTERING: If session has no valid name (e.g. class deleted), hide it
      if (!actualTitle) {
        return null;
      }

      sessionObj.classId = {
        ...baseInfo,
        title: actualTitle,
        name: actualTitle
      };

      // SELF-HEALING: If session is missing locationId but memberships have it, restore it
      if (!session.locationId && memberships.length > 0) {
        const firstValidLocationId = memberships.find(m => m.locationId)?.locationId;
        if (firstValidLocationId) {
          session.locationId = firstValidLocationId;
          sessionObj.locationId = firstValidLocationId;
          await session.save().catch(err => console.error(`[SessionHealer] Failed to fix location for ${session._id}:`, err.message));
        }
      }

      // SELF-HEALING: If it's a 'Class' but not marked 'isManual', fix it so it shows on the schedule
      // This catches any older sessions that were created before the naming and manual flag logic was added.
      if (session.classType === 'Class' && !session.isManual) {
        session.isManual = true;
        sessionObj.isManual = true;
        await session.save().catch(err => console.error(`[SessionHealer] Failed to fix manual flag for ${session._id}:`, err.message));
      }

      // Robust fallback: if trainer is TBA but session is from a membership with a fixed trainer
      if (!sessionObj.trainerId && (session.membershipId || memberships.length > 0)) {
        const Membership = mongoose.model('Membership');
        const Plan = mongoose.model('Plan');

        // Try to find any associated membership that might have a fixed trainer plan
        const mId = session.membershipId || (memberships.length > 0 ? memberships[0]._id : null);
        if (mId) {
          const m = await Membership.findById(mId);
          if (m) {
            const p = await Plan.findById(m.planId).populate('trainerId', 'name');
            if (p && p.trainerId && p.trainerAllocation === 'fixed') {
              sessionObj.trainerId = p.trainerId;
              sessionObj.trainerStatus = 'accepted';
            }
          }
        }
      }

      return sessionObj;
    })
  )).filter(Boolean);

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
    locationId,
    isManual: true
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
    const MembershipModel = mongoose.model('Membership');
    const ClassModel = mongoose.model('Class');

    const affectedBookings = await BookingModel.find({
      sessionId: session._id,
      status: { $in: ['confirmed', 'pending', 'attended', 'no-show'] }
    });

    for (const booking of affectedBookings) {
      const oldStatus = booking.status;
      booking.status = 'trainer-cancelled';
      booking.cancellationReason = `Session cancelled: ${session.cancellationReason}`;
      await booking.save();

      // RESTORATION LOGIC: If it was already marked 'attended' or 'no-show', deduction might have happened.
      // We should restore the session/credits.
      if (booking.membershipId && (oldStatus === 'attended' || oldStatus === 'no-show')) {
        const membership = await MembershipModel.findById(booking.membershipId);
        const cls = await ClassModel.findById(booking.classId);
        if (membership) {
          if (membership.classesRemaining !== -1) membership.classesRemaining += 1;
          if (membership.creditsRemaining > 0) membership.creditsRemaining += (cls?.creditCost || 1);
          await membership.save();
        }
      }
    }
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

  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
  let isAssignedTrainer = false;
  let isClaimable = false;

  const TrainerModel = mongoose.model('Trainer');
  const trainer = await TrainerModel.findOne({ userId: req.user._id });

  if (trainer) {
    if (session.trainerId && session.trainerId.toString() === trainer._id.toString()) {
      isAssignedTrainer = true;
    } else if (!session.trainerId && trainer.locationIds.some(id => id.toString() === (session.locationId?._id || session.locationId).toString())) {
      // It's unassigned (Random) and trainer is at the same location
      isClaimable = true;
    }
  }

  if (!isAdmin && !isAssignedTrainer && !isClaimable) {
    res.status(403);
    throw new Error('Not authorized to update trainer status for this session');
  }

  // Keep random sessions visible to all trainers until one of them accepts.
  // A trainer pressing "Reject" on an unclaimed slot should not globally hide it.
  if (isClaimable && trainerStatus === 'rejected') {
    session.trainerStatus = 'pending';
    const saved = await session.save();
    return res.json(saved);
  }

  // If an assigned trainer rejects, reopen the slot so other trainers can claim it.
  if (isAssignedTrainer && trainerStatus === 'rejected' && !isAdmin) {
    session.trainerId = null;
    session.trainerStatus = 'pending';
    const saved = await session.save();
    return res.json(saved);
  }

  // If claiming an unassigned session
  if (isClaimable && trainerStatus === 'accepted') {
    session.trainerId = trainer._id;
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
        locationId,
        isManual: true
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
