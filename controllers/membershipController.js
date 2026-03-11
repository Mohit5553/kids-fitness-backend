import asyncHandler from 'express-async-handler';
import Membership from '../models/Membership.js';
import Plan from '../models/Plan.js';
import { resolveReadLocationId } from '../utils/locationScope.js';

const addWeeks = (date, weeks) => new Date(date.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

export const getMyMemberships = asyncHandler(async (req, res) => {
  const memberships = await Membership.find({ userId: req.user._id })
    .populate('planId', 'name price validity type classesIncluded durationWeeks')
    .sort({ createdAt: -1 });
  res.json(memberships);
});

export const getAllMemberships = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const memberships = await Membership.find(filter)
    .populate('userId', 'name email')
    .populate('planId', 'name price validity type classesIncluded durationWeeks')
    .sort({ createdAt: -1 });
  res.json(memberships);
});

export const createMembership = asyncHandler(async (req, res) => {
  const { planId, autoRenew, paymentId } = req.body;
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
  const endDate = plan.durationWeeks ? addWeeks(startDate, plan.durationWeeks) : undefined;
  const classesRemaining = plan.classesIncluded ?? (plan.type === 'dropin' ? 1 : undefined);

  const created = await Membership.create({
    userId: req.user._id,
    planId,
    startDate,
    endDate,
    autoRenew: Boolean(autoRenew),
    classesRemaining,
    paymentId,
    locationId: plan.locationId
  });

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
  res.json(saved);
});
