import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Plan from '../models/Plan.js';
import Promotion from '../models/Promotion.js';
import Session from '../models/Session.js';
import Membership from '../models/Membership.js';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';
import { withUAT } from '../middleware/uatMiddleware.js';

export const getPlans = asyncHandler(async (req, res) => {
  const { locationId: queryLocationId, all } = req.query;
  const locationId = queryLocationId || resolveReadLocationId(req);

  // Show plans for the specific location OR global plans (locationId: null)
  let filter = (locationId && locationId !== 'all') ? { $or: [{ locationId }, { locationId: null }] } : {};

  // If not 'all=true' (public view), only show active plans
  if (all !== 'true') {
    filter.status = 'active';
  }

  const plans = await Plan.find(withUAT(req, filter))
    .populate('locationId', 'name')
    .populate('trainerId', 'name avatarUrl')
    .sort({ createdAt: -1 });

  // Fetch active promotions
  const now = new Date();
  const activePromos = await Promotion.find(withUAT(req, {
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now }
  })).lean();

  // Fetch names for bonuses
  const allPlans = await Plan.find({}, 'name').lean();
  const ClassModel = mongoose.models.Class;
  const allClasses = ClassModel ? await ClassModel.find({}, 'title').lean() : [];

  const getBonusName = (type, id) => {
    if (!id) return '';
    if (type === 'plan') {
      const p = allPlans.find(x => x._id.toString() === id.toString());
      return p ? p.name : 'Specific Plan';
    } else if (type === 'class') {
      const c = allClasses.find(x => x._id.toString() === id.toString());
      return c ? c.title : 'Specific Class';
    }
    return '';
  };

  // Attach promotions and bonus names to each plan
  const plansWithPromos = plans.map(p => {
    const planObj = p.toObject();

    // Resolve old bonus structure name
    if (planObj.bonusItemType !== 'same' && planObj.bonusItemId) {
      planObj.bonusItemName = getBonusName(planObj.bonusItemType, planObj.bonusItemId);
    }

    // Resolve array bonuses names
    if (planObj.bonuses && planObj.bonuses.length > 0) {
      planObj.bonuses = planObj.bonuses.map(b => {
        if (b.itemType !== 'same' && b.itemId) {
          b.itemName = getBonusName(b.itemType, b.itemId);
        }
        return b;
      });
    }

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
  const {
    name, price, benefits, type, classesIncluded,
    durationWeeks, durationValue, durationUnit,
    validity, validityValue, validityUnit,
    billingCycle, tagline, isFeatured, sessionType,
    validDays, gender, timeSlots, trainerAllocation, trainerId, extensionRules,
    bonusQuantity, bonusItemType, bonusItemId, bonuses,
    replicateToLocations, sessionsPerWeek, taxId, categoryId, dailyBookingLimit, creditsIncluded
  } = req.body;

  if (!name || price == null) {
    res.status(400);
    throw new Error('Name and price are required');
  }

  const locationId = resolveWriteLocationId(req);
  if (req.user?.role !== 'superadmin' && !locationId) {
    res.status(400);
    throw new Error('Location is required');
  }

  // Auto-generate validity string if value/unit provided
  let finalValidity = validity;
  if (validityValue && validityUnit) {
    finalValidity = `${validityValue} ${validityUnit}`;
  }

  // Auto-calculate durationWeeks if value/unit provided
  let finalDurationWeeks = durationWeeks;
  if (durationValue && durationUnit) {
    if (durationUnit === 'days') finalDurationWeeks = durationValue / 7;
    else if (durationUnit === 'weeks') finalDurationWeeks = durationValue;
    else if (durationUnit === 'months') finalDurationWeeks = durationValue * 4.34; // Approx
  }

  const finalTrainerId = (trainerAllocation === 'fixed' && trainerId) ? trainerId : null;

  const created = await Plan.create({
    name, price,
    validity: finalValidity, validityValue, validityUnit,
    benefits, type, classesIncluded,
    durationWeeks: finalDurationWeeks, durationValue, durationUnit,
    billingCycle, tagline, isFeatured, sessionType, validDays, gender, timeSlots,
    trainerAllocation, trainerId: finalTrainerId, extensionRules, locationId,
    bonusQuantity, bonusItemType, bonusItemId, bonuses,
    sessionsPerWeek, taxId, categoryId, dailyBookingLimit, creditsIncluded,
    isUAT: req.isUAT || false
  });

  if (Array.isArray(replicateToLocations) && replicateToLocations.length > 0) {
    const locationsToReplicate = replicateToLocations
      .filter(locId => locId && mongoose.Types.ObjectId.isValid(locId) && locId.toString() !== locationId?.toString());

    for (const locId of locationsToReplicate) {
      const existing = await Plan.findOne({ name: created.name, locationId: locId, isUAT: created.isUAT || false });

      const planData = {
        name, price,
        validity: finalValidity, validityValue, validityUnit,
        benefits, type, classesIncluded,
        durationWeeks: finalDurationWeeks, durationValue, durationUnit,
        billingCycle, tagline, isFeatured, sessionType, validDays, gender, timeSlots,
        trainerAllocation, trainerId: finalTrainerId, extensionRules, locationId: locId,
        bonusQuantity, bonusItemType, bonusItemId, bonuses,
        sessionsPerWeek, taxId, categoryId, dailyBookingLimit, creditsIncluded,
        isUAT: req.isUAT || false
      };

      if (!existing) {
        await Plan.create(planData);
      } else {
        Object.assign(existing, planData);
        existing.locationId = locId; // ensure location remains correct
        await existing.save();
      }
    }
  }

  res.status(201).json(created);
});

import fs from 'fs';

export const updatePlan = asyncHandler(async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) {
    res.status(404);
    throw new Error('Plan not found');
  }

  if (req.user?.role === 'admin' && req.user.locationId && plan.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }

  const oldTrainerId = plan.trainerId?.toString();
  const updates = { ...req.body };
  console.log("=== UPDATE PLAN REQ BODY ===", req.body);
  fs.appendFileSync('d:/jts/kids fitness/kids-fitness-backend/req_body_log.txt', JSON.stringify(req.body) + '\n');
  if (updates.locationId === 'all') updates.locationId = null;

  const { replicateToLocations } = req.body;

  // Sync logic for updates
  if (updates.validityValue && updates.validityUnit) {
    updates.validity = `${updates.validityValue} ${updates.validityUnit}`;
  }
  if (updates.durationValue && updates.durationUnit) {
    if (updates.durationUnit === 'days') updates.durationWeeks = updates.durationValue / 7;
    else if (updates.durationUnit === 'weeks') updates.durationWeeks = updates.durationValue;
    else if (updates.durationUnit === 'months') updates.durationWeeks = updates.durationValue * 4.34;
  }

  if (updates.trainerId === '') updates.trainerId = null;
  if (updates.trainerAllocation === 'random') updates.trainerId = null;

  const trainerChanged = updates.trainerId && updates.trainerId.toString() !== oldTrainerId;

  plan.set(updates);
  if (updates.sessionsPerWeek !== undefined) {
    plan.sessionsPerWeek = updates.sessionsPerWeek;
  }
  if (updates.dailyBookingLimit !== undefined) {
    plan.dailyBookingLimit = Number(updates.dailyBookingLimit);
  }
  const saved = await plan.save();

  // Sync the sessionsPerWeek and dailyBookingLimit limits to all location-wise variations of this plan
  if (updates.sessionsPerWeek !== undefined || updates.dailyBookingLimit !== undefined) {
    await Plan.updateMany(
      { name: plan.name },
      {
        sessionsPerWeek: plan.sessionsPerWeek,
        dailyBookingLimit: plan.dailyBookingLimit
      }
    );
  }

  // If trainer was updated, sync to memberships and upcoming sessions
  if (trainerChanged && updates.trainerAllocation === 'fixed') {
    console.log(`[Plan Sync] Propagating trainer change for plan ${plan.name} to all active records...`);

    // 1. Update active memberships
    await Membership.updateMany(
      { planId: plan._id, status: 'active' },
      { trainerId: updates.trainerId }
    );

    // 2. Update upcoming sessions
    await Session.updateMany(
      {
        classId: plan._id,
        classType: 'Plan',
        startTime: { $gte: new Date() }
      },
      {
        trainerId: updates.trainerId,
        trainerStatus: 'accepted'
      }
    );
  }

  if (Array.isArray(replicateToLocations) && replicateToLocations.length > 0) {
    const locationsToReplicate = replicateToLocations
      .filter(locId => locId && mongoose.Types.ObjectId.isValid(locId) && locId.toString() !== plan.locationId?.toString());

    for (const locId of locationsToReplicate) {
      const existing = await Plan.findOne({ name: plan.name, locationId: locId, isUAT: plan.isUAT || false });

      const planData = {
        name: plan.name,
        price: plan.price,
        validity: plan.validity,
        validityValue: plan.validityValue,
        validityUnit: plan.validityUnit,
        benefits: plan.benefits,
        type: plan.type,
        classesIncluded: plan.classesIncluded,
        durationWeeks: plan.durationWeeks,
        durationValue: plan.durationValue,
        durationUnit: plan.durationUnit,
        billingCycle: plan.billingCycle,
        tagline: plan.tagline,
        isFeatured: plan.isFeatured,
        sessionType: plan.sessionType,
        validDays: plan.validDays,
        gender: plan.gender,
        timeSlots: plan.timeSlots,
        trainerAllocation: plan.trainerAllocation,
        trainerId: plan.trainerId,
        extensionRules: plan.extensionRules,
        bonusQuantity: plan.bonusQuantity,
        bonusItemType: plan.bonusItemType,
        bonusItemId: plan.bonusItemId,
        bonuses: plan.bonuses,
        taxId: plan.taxId,
        categoryId: plan.categoryId,
        dailyBookingLimit: plan.dailyBookingLimit,
        sessionsPerWeek: plan.sessionsPerWeek,
        creditsIncluded: plan.creditsIncluded,
        locationId: locId,
        isUAT: plan.isUAT || false,
        status: plan.status || 'active'
      };

      if (!existing) {
        await Plan.create(planData);
      } else {
        Object.assign(existing, planData);
        existing.locationId = locId; // ensure location remains correct
        await existing.save();
      }
    }
  }

  res.json(saved);
});

export const setPlanStatus = asyncHandler(async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) {
    res.status(404);
    throw new Error('Plan not found');
  }

  plan.status = req.body.status || (plan.status === 'active' ? 'inactive' : 'active');
  await plan.save();
  res.json(plan);
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
