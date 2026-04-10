import asyncHandler from 'express-async-handler';
import Plan from '../models/Plan.js';
import Promotion from '../models/Promotion.js';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

export const getPlans = asyncHandler(async (req, res) => {
  const { locationId: queryLocationId } = req.query;
  const locationId = queryLocationId || resolveReadLocationId(req);
  
  // Show plans for the specific location OR global plans (locationId: null)
  const filter = (locationId && locationId !== 'all') ? { $or: [{ locationId }, { locationId: null }] } : {};
  
  const plans = await Plan.find(filter)
    .populate('locationId', 'name')
    .populate('trainerId', 'name avatarUrl')
    .sort({ createdAt: -1 });

  // Fetch active promotions
  const now = new Date();
  const activePromos = await Promotion.find({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now }
  }).lean();

  // Attach promotions to each plan
  const plansWithPromos = plans.map(p => {
    const planObj = p.toObject();
    planObj.activePromotions = activePromos.filter(promo => {
        // Global promotion for this location?
        if (promo.applicableLocations && promo.applicableLocations.length > 0) {
            // If the plan is location-specific, check if the promo applies to that location
            if (planObj.locationId && !promo.applicableLocations.some(locId => locId.toString() === (planObj.locationId._id || planObj.locationId).toString())) {
                return false;
            }
        }

        // Specific plan promotion?
        const hasItemConstraint = (promo.applicableClasses && promo.applicableClasses.length > 0) || 
                                 (promo.applicablePlans && promo.applicablePlans.length > 0);
        
        if (!hasItemConstraint) return true; // General location/global promo

        return promo.applicablePlans?.some(id => id.toString() === planObj._id.toString());
    });
    return planObj;
  });

  res.json(plansWithPromos);
});

export const createPlan = asyncHandler(async (req, res) => {
  const { name, price, validity, benefits, type, classesIncluded, durationWeeks, billingCycle, tagline, isFeatured, sessionType, validDays, timeSlots, trainerAllocation, trainerId, extensionRules } = req.body;
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

  // Ensure empty string is null for trainerId to avoid BSON error
  const finalTrainerId = (trainerAllocation === 'fixed' && trainerId) ? trainerId : null;

  const created = await Plan.create({ name, price, validity, benefits, type, classesIncluded, durationWeeks, billingCycle, tagline, isFeatured, sessionType, validDays, timeSlots, trainerAllocation, trainerId: finalTrainerId, extensionRules, locationId });
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

  // Ensure empty string is null for trainerId to avoid BSON error
  if (updates.trainerId === '') updates.trainerId = null;
  if (updates.trainerAllocation === 'random') updates.trainerId = null;

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
