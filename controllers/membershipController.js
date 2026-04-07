import asyncHandler from 'express-async-handler';
import Membership from '../models/Membership.js';
import Plan from '../models/Plan.js';
import User from '../models/User.js';
import { generateMembershipSessions } from '../services/schedulingService.js';
import { resolveReadLocationId } from '../utils/locationScope.js';
import { sendMembershipUpdateEmail } from '../utils/mailer.js';
import Booking from '../models/Booking.js';
import Child from '../models/Child.js';
import Payment from '../models/Payment.js';

const addWeeks = (date, weeks) => new Date(date.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
const addMonths = (date, months) => {
  const newDate = new Date(date);
  newDate.setMonth(newDate.getMonth() + months);
  return newDate;
};
const addYears = (date, years) => {
  const newDate = new Date(date);
  newDate.setFullYear(newDate.getFullYear() + years);
  return newDate;
};

export const getMyMemberships = asyncHandler(async (req, res) => {
  const memberships = await Membership.find({ userId: req.user._id })
    .populate('planId')
    .populate({
      path: 'generatedSessions',
      populate: { path: 'trainerId', select: 'name' }
    })
    .sort({ createdAt: -1 });
  res.json(memberships);
});

export const getAllMemberships = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const memberships = await Membership.find(filter)
    .populate('userId', 'name email')
    .populate('planId', 'name price validity type classesIncluded durationWeeks billingCycle')
    .sort({ createdAt: -1 });
  res.json(memberships);
});

export const createMembership = asyncHandler(async (req, res) => {
  const { planId, autoRenew, paymentId, childId, preferredDays, preferredSlots, sessionsPerWeek } = req.body;
  if (!planId) {
    res.status(400);
    throw new Error('planId is required');
  }

  const plan = await Plan.findById(planId);
  if (!plan) {
    res.status(404);
    throw new Error('Plan not found');
  }

  const startDate = new Date();
  let endDate;

  if (plan.type === 'subscription' && plan.billingCycle && plan.billingCycle !== 'none') {
    if (plan.billingCycle === 'weekly') {
      endDate = addWeeks(startDate, 1);
    } else if (plan.billingCycle === 'monthly') {
      endDate = addMonths(startDate, 1);
    } else if (plan.billingCycle === 'yearly') {
      endDate = addYears(startDate, 1);
    }
  } else if (plan.durationWeeks) {
    endDate = addWeeks(startDate, plan.durationWeeks);
  }

  const classesRemaining = plan.classesIncluded ?? (plan.type === 'dropin' ? 1 : undefined);
  
  // Resolve Target User ID: If the requester is an admin/staff, they might be booking for someone else (represented by req.body.userId)
  const isStaff = req.user && !['parent', 'customer'].includes((req.user.role || '').toLowerCase());
  const targetUserId = (isStaff && req.body.userId) ? req.body.userId : req.user._id;

  const created = await Membership.create({
    userId: targetUserId,
    planId,
    startDate,
    endDate,
    autoRenew: Boolean(autoRenew),
    classesRemaining,
    childId,
    preferredDays,
    preferredSlots,
    sessionsPerWeek,
    paymentId,
    locationId: plan.locationId
  });

  // Auto-generate sessions
  if (preferredDays && preferredSlots && preferredDays.length > 0) {
    const sessionIds = await generateMembershipSessions(created, plan);
    created.generatedSessions = sessionIds;
    await created.save();
  }

  // CREATE UNIFIED BOOKING RECORD FOR THIS PACKAGE
  try {
      const child = await Child.findById(childId);
      const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
      const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
      const bookingNumber = `BK-PKG-${dateStr}-${randomStr}`;

      // Resolve the actual payment method if we have a paymentId
      let resolvedPaymentMethod = 'center';
      if (paymentId) {
          const payRec = await Payment.findById(paymentId);
          if (payRec) resolvedPaymentMethod = payRec.paymentMethod;
      }

      const bookingData = {
          userId: targetUserId,
          bookingNumber,
          bookingType: 'package',
          planId: plan._id,
          date: startDate,
          totalAmount: plan.price,
          status: 'confirmed',
          paymentStatus: 'completed',
          paymentMethod: resolvedPaymentMethod,
          paymentId: paymentId,
          locationId: plan.locationId,
          participants: child ? [{
              name: child.name,
              age: child.age,
              gender: child.gender,
              relation: 'Child',
              childId: child._id
          }] : []
      };

      // Record administrative processing if applicable
      if (isStaff) {
          bookingData.processedBy = req.user._id;
          bookingData.processedByRole = req.user.role;
      }

      await Booking.create(bookingData);
  } catch (err) {
      console.error('[Membership -> Booking Sync] Failed:', err.message);
  }

  res.status(201).json(created);
});

export const updateMembership = asyncHandler(async (req, res) => {
  const membership = await Membership.findById(req.params.id);
  if (!membership) {
    res.status(404);
    throw new Error('Membership not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && membership.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  Object.assign(membership, req.body);
  const saved = await membership.save();

  // Notify User
  const userData = await User.findById(saved.userId);
  const planData = await Plan.findById(saved.planId);
  if (userData && planData) {
    sendMembershipUpdateEmail(saved, userData, planData).catch(err => console.error('Membership update email failed:', err.message));
  }

  res.json(saved);
});
