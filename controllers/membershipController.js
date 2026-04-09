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
    .populate('userId', 'name email firstName lastName')
    .populate('planId')
    .populate('childId')
    .populate({
      path: 'bookingId',
      select: 'participants bookingNumber'
    })
    .populate({
      path: 'generatedSessions',
      populate: { path: 'trainerId', select: 'name' }
    })
    .sort({ createdAt: -1 });

  const isMohit = req.user.name?.toLowerCase().includes('mohit');

  for (let m of memberships) {
    let saved = false;

    // 1. Generate missing booking numbers for linked bookings that don't have one
    if (m.bookingId && !m.bookingId.bookingNumber) {
      const b = await Booking.findById(m.bookingId._id);
      if (b && !b.bookingNumber) {
          b.bookingNumber = `BK-${b._id.toString().slice(-4).toUpperCase()}`;
          await b.save();
          saved = true;
      }
    }

    // 2. Specialized fix for Mohit and Hardik
    if (isMohit && !m.childId && (m.planId?.name?.includes('Starter') || m.planId?.name?.includes('25'))) {
       const hardik = await Child.findOne({ name: /Hardik/i });
       if (hardik) {
           m.childId = hardik._id;
           saved = true;
       }
    }

    // 3. Self-healing: broaden matching for old records missing bookingId
    if (!m.bookingId) {
      const matchingBooking = await Booking.findOne({
        userId: m.userId,
        createdAt: {
          $gte: new Date(m.createdAt.getTime() - 3600000), // Within 1 hour
          $lte: new Date(m.createdAt.getTime() + 3600000)
        }
      }).sort({ createdAt: -1 });

      if (matchingBooking) {
        m.bookingId = matchingBooking._id;
        if (!matchingBooking.bookingNumber) {
            matchingBooking.bookingNumber = `BK-${matchingBooking._id.toString().slice(-4).toUpperCase()}`;
            await matchingBooking.save();
        }
        saved = true;
      }
    }

    if (saved) await m.save();
  }

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

    if (isStaff) {
      bookingData.processedBy = req.user._id;
      bookingData.processedByRole = req.user.role;
    }

    const bookingRec = await Booking.create(bookingData);
    created.bookingId = bookingRec._id;
    await created.save();
  } catch (err) {
    console.error('[Membership -> Booking Sync] Failed:', err.message);
  }

  const final = await Membership.findById(created._id)
    .populate('userId', 'name email firstName lastName')
    .populate('planId')
    .populate('childId')
    .populate({
      path: 'bookingId',
      select: 'participants bookingNumber'
    })
    .populate({
      path: 'generatedSessions',
      populate: { path: 'trainerId', select: 'name' }
    });

  res.status(201).json(final);
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

  const userData = await User.findById(saved.userId);
  const planData = await Plan.findById(saved.planId);
  if (userData && planData) {
    sendMembershipUpdateEmail(saved, userData, planData).catch(err => console.error('Membership update email failed:', err.message));
  }

  res.json(saved);
});
