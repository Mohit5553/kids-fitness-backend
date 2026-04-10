import asyncHandler from 'express-async-handler';
import ClassModel from '../models/Class.js';
import Plan from '../models/Plan.js';
import Promotion from '../models/Promotion.js';
import mongoose from 'mongoose';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

export const getClasses = asyncHandler(async (req, res) => {
  const { locationId: queryLocationId, all } = req.query;
  const locationId = queryLocationId || resolveReadLocationId(req);
  
  const filter = (locationId && locationId !== 'all') ? { locationId } : {};
  if (all !== 'true') {
    filter.status = 'active';
  }

  // Fetch classes
  const classes = await ClassModel.find(filter)
    .populate('availableTrainers', 'name status locationIds bio specialties avatarUrl gallery')
    .sort({ createdAt: -1 });

  // Fetch active promotions
  const now = new Date();
  const activePromos = await Promotion.find({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now }
  }).lean();

  // Attach promotions to each class
  const classesWithPromos = classes.map(c => {
    const classObj = c.toObject();
    classObj.activePromotions = activePromos.filter(p => {
      // Global promotion for this location?
      if (p.applicableLocations && p.applicableLocations.length > 0) {
        if (!p.applicableLocations.some(locId => locId.toString() === classObj.locationId?.toString())) {
            return false;
        }
      }

      // Specific class promotion?
      const hasItemConstraint = (p.applicableClasses && p.applicableClasses.length > 0) || 
                               (p.applicablePlans && p.applicablePlans.length > 0);
      
      if (!hasItemConstraint) return true; // It's a general location/global promo

      return p.applicableClasses?.some(id => id.toString() === classObj._id.toString());
    });
    return classObj;
  });

  res.json(classesWithPromos);
});

export const getClassById = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { _id: req.params.id, locationId } : { _id: req.params.id };
  const classItem = await ClassModel.findOne(filter).populate('availableTrainers', 'name status locationIds bio specialties avatarUrl gallery');
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }
  res.json(classItem);
});

export const createClass = asyncHandler(async (req, res) => {
  const { title, description, ageGroup, duration, availableTrainers, price, capacity, imageUrl } = req.body;
  if (!title || price == null) {
    res.status(400);
    throw new Error('Title and price are required');
  }
  const locationId = resolveWriteLocationId(req);
  if (!locationId) {
    res.status(400);
    throw new Error('Location is required');
  }
  const created = await ClassModel.create({
    title,
    description,
    ageGroup,
    duration,
    availableTrainers,
    price,
    capacity,
    imageUrl,
    locationId
  });
  res.status(201).json(created);
});

export const updateClass = asyncHandler(async (req, res) => {
  const classItem = await ClassModel.findById(req.params.id);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && classItem.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  Object.assign(classItem, req.body);
  const saved = await classItem.save();
  res.json(saved);
});

export const deleteClass = asyncHandler(async (req, res) => {
  const classItem = await ClassModel.findById(req.params.id);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }

  // Dependency Check: Block ONLY if there are FUTURE scheduled sessions
  const Session = mongoose.model('Session');
  const futureSessionCount = await Session.countDocuments({ 
    classId: classItem._id, 
    startTime: { $gt: new Date() },
    status: 'scheduled'
  });
  
  if (futureSessionCount > 0) {
    res.status(400);
    throw new Error(`Cannot disable class: There are ${futureSessionCount} future sessions scheduled. Please cancel them first.`);
  }

  if (req.user?.role === 'admin' && req.user.locationId && classItem.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }

  // Toggle status instead of deleting
  classItem.status = classItem.status === 'active' ? 'inactive' : 'active';
  await classItem.save();

  res.json({ message: `Class status updated to ${classItem.status}`, status: classItem.status });
});
