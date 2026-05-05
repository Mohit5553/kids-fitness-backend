import asyncHandler from 'express-async-handler';
import ExtensionRequest from '../models/ExtensionRequest.js';
import Membership from '../models/Membership.js';
import Session from '../models/Session.js';
import { generateMembershipSessions } from '../services/schedulingService.js';
import { notifyAdmins } from '../utils/socketUtils.js';

// @desc    Submit an extension or reschedule request
// @route   POST /api/extensions/request
// @access  Private
export const requestExtension = asyncHandler(async (req, res) => {
  const { membershipId, type, reason, targetSessionId, newDate, newSlot } = req.body;

  const membership = await Membership.findById(membershipId).populate('planId');
  if (!membership) {
    res.status(404);
    throw new Error('Membership not found');
  }

  // Check eligibility for reschedule
  if (type === 'reschedule') {
    const missedCount = await Session.countDocuments({ 
      membershipId, 
      attendanceStatus: 'absent' 
    });
    
    const allowed = membership.planId.extensionRules?.maxAllowedMissed || 2;
    if (missedCount >= allowed) {
      res.status(400);
      throw new Error(`Maximum missed sessions limit (${allowed}) reached. Cannot reschedule.`);
    }
  }

  const request = await ExtensionRequest.create({
    membershipId,
    userId: req.user._id,
    type,
    reason,
    targetSessionId,
    newDate,
    newSlot
  });

  notifyAdmins(req, 'new_extension', { 
    requestId: request._id, 
    locationId: membership.locationId 
  });

  res.status(201).json(request);
});

// @desc    Approve/Reject extension request
// @route   POST /api/extensions/:id/process
// @access  Private/Admin
export const processExtension = asyncHandler(async (req, res) => {
  const { status, adminNotes } = req.body;
  const request = await ExtensionRequest.findById(req.params.id);
  
  if (!request) {
    res.status(404);
    throw new Error('Request not found');
  }

  request.status = status;
  request.adminNotes = adminNotes;
  request.processedBy = req.user._id;
  request.processedAt = new Date();

  if (status === 'approved') {
    if (request.type === 'reschedule' && request.targetSessionId) {
      const session = await Session.findById(request.targetSessionId);
      if (session) {
        session.startTime = request.newDate;
        session.attendanceStatus = 'booked'; // Reset to booked
        await session.save();
      }
    } else if (request.type === 'extend') {
      const membership = await Membership.findById(request.membershipId);
      if (membership) {
        // Save the old end date before changing it
        membership.previousEndDate = membership.endDate;

        if (request.newDate) {
          // Use the exact date requested by the member
          membership.endDate = new Date(request.newDate);
        } else {
          // Fallback: add 7 days
          const buffer = 7;
          const currentEnd = new Date(membership.endDate);
          membership.endDate = new Date(currentEnd.getTime() + buffer * 24 * 60 * 60 * 1000);
        }

        // RE-GENERATE SESSIONS for the extended period
        const plan = await Membership.model('Plan').findById(membership.planId);
        if (plan) {
          const newSessionIds = await generateMembershipSessions(membership, plan);
          
          // Merge without duplicates
          const existingIds = new Set(membership.generatedSessions.map(id => id.toString()));
          const uniqueNewIds = newSessionIds.filter(id => !existingIds.has(id.toString()));
          
          if (uniqueNewIds.length > 0) {
            membership.generatedSessions.push(...uniqueNewIds);
          }
        }

        await membership.save();
      }
    }
  }

  const saved = await request.save();
  res.json(saved);
});

// @desc    Get my extension requests
export const getMyExtensions = asyncHandler(async (req, res) => {
  const requests = await ExtensionRequest.find({ userId: req.user._id })
    .populate({
      path: 'membershipId',
      populate: { path: 'planId' }
    })
    .populate({
      path: 'targetSessionId',
      populate: { path: 'classId' }
    })
    .sort({ createdAt: -1 });
  res.json(requests);
});

// @desc    Get all extension requests (Admin)
export const getAllExtensions = asyncHandler(async (req, res) => {
  const requests = await ExtensionRequest.find({})
    .populate('userId', 'name email')
    .populate({
      path: 'membershipId',
      populate: { path: 'planId' }
    })
    .populate({
      path: 'targetSessionId',
      populate: { path: 'classId' }
    })
    .sort({ createdAt: -1 });
  res.json(requests);
});
