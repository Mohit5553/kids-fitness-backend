import asyncHandler from 'express-async-handler';
import Plan from '../models/Plan.js';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

export const getPlans = asyncHandler(async (req, res) => {
  const { locationId: queryLocationId } = req.query;
  const locationId = queryLocationId || resolveReadLocationId(req);
  // Show plans for the specific location OR global plans (locationId: null)
  const filter = (locationId && locationId !== 'all') ? { $or: [{ locationId }, { locationId: null }] } : {};
  const plans = await Plan.find(filter).populate('locationId', 'name').sort({ createdAt: -1 });
  res.json(plans);
});

export const createPlan = asyncHandler(async (req, res) => {
  const { name, price, validity, benefits, type, classesIncluded, durationWeeks, billingCycle, tagline, isFeatured } = req.body;
  if (!name || price == null) {
    res.status(400);
    throw new Error('Name and price are required');
  }
  const locationId = resolveWriteLocationId(req);
  // Superadmin can create global plans; admins must have a location
  if (req.user?.role !== 'superadmin' && !locationId) {
    res.status(400);
    throw new Error('Location is required');
  }
  const created = await Plan.create({ name, price, validity, benefits, type, classesIncluded, durationWeeks, billingCycle, tagline, isFeatured, locationId });
  res.status(201).json(created);
});

export const updatePlan = asyncHandler(async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) {
    res.status(404);
    throw new Error('Plan not found');
  }
  // Restrict admins to their own location
  if (req.user?.role === 'admin' && req.user.locationId && plan.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }

  const updates = { ...req.body };
  // Handle 'all' as null for global plans from UI
  if (updates.locationId === 'all') updates.locationId = null;

  Object.assign(plan, updates);
  const saved = await plan.save();
  res.json(saved);
});

export const deletePlan = asyncHandler(async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) {
    res.status(404);
    throw new Error('Plan not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && plan.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  await plan.deleteOne();
  res.json({ message: 'Plan removed' });
});
