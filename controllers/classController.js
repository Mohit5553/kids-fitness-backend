import asyncHandler from 'express-async-handler';
import ClassModel from '../models/Class.js';
import Plan from '../models/Plan.js';
import Promotion from '../models/Promotion.js';
import mongoose from 'mongoose';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';
import { withUAT } from '../middleware/uatMiddleware.js';

export const getClasses = asyncHandler(async (req, res) => {
  const { locationId: queryLocationId, all } = req.query;
  const locationId = queryLocationId || resolveReadLocationId(req);
  
  let filter = (locationId && locationId !== 'all') ? { locationId } : {};
  if (all !== 'true') {
    filter.status = 'active';
  }

  // Fetch classes with environment isolation
  const classes = await ClassModel.find(withUAT(req, filter))
    .populate('availableTrainers', 'name status locationIds bio specialties avatarUrl gallery')
    .sort({ createdAt: -1 });

  // Fetch active promotions
  const now = new Date();
  const activePromos = await Promotion.find(withUAT(req, {
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now }
  })).lean();

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
  let filter = { _id: req.params.id };
  if (locationId && locationId !== 'all') {
    filter.locationId = locationId;
  }
  
  const classItem = await ClassModel.findOne(withUAT(req, filter))
    .populate('availableTrainers', 'name status locationIds bio specialties avatarUrl gallery');
    
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }
  res.json(classItem);
});

export const createClass = asyncHandler(async (req, res) => {
  const { title, description, ageGroup, duration, availableTrainers, price, capacity, imageUrl, creditCost } = req.body;
  if (!title || price == null) {
    res.status(400);
    throw new Error('Title and price are required');
  }
  const locationId = resolveWriteLocationId(req);
  if (!locationId) {
    res.status(400);
    throw new Error('Location is required');
  }

  const validTrainers = Array.isArray(availableTrainers)
    ? availableTrainers.filter(t => t && mongoose.Types.ObjectId.isValid(t))
    : [];

  if (validTrainers.length === 0) {
    res.status(400);
    throw new Error('At least one trainer is required');
  }

  const created = await ClassModel.create({
    title,
    description,
    ageGroup,
    duration,
    availableTrainers: validTrainers,
    price,
    capacity: (capacity === '' || capacity == null) ? null : Number(capacity),
    imageUrl,
    creditCost: creditCost || 1,
    locationId,
    isUAT: req.isUAT || false,
    categoryId: req.body.categoryId,
    taxId: req.body.taxId,
    status: req.body.status || 'active',
    minAge: req.body.minAge,
    maxAge: req.body.maxAge,
    color: req.body.color
  });

  if (req.body.replicateToLocations && Array.isArray(req.body.replicateToLocations)) {
    const locationsToReplicate = req.body.replicateToLocations.filter(id => id !== locationId.toString());
    for (const locId of locationsToReplicate) {
      if (mongoose.Types.ObjectId.isValid(locId)) {
        await ClassModel.create({
          ...created.toObject(),
          _id: new mongoose.Types.ObjectId(),
          locationId: locId
        });
      }
    }
  }

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

  if (req.body.availableTrainers !== undefined) {
    const validTrainers = Array.isArray(req.body.availableTrainers)
      ? req.body.availableTrainers.filter(t => t && mongoose.Types.ObjectId.isValid(t))
      : [];
    if (validTrainers.length === 0) {
      res.status(400);
      throw new Error('At least one trainer is required');
    }
    req.body.availableTrainers = validTrainers;
  }

  if (req.body.capacity !== undefined) {
    req.body.capacity = (req.body.capacity === '' || req.body.capacity == null) ? null : Number(req.body.capacity);
  }

  Object.assign(classItem, req.body);
  const saved = await classItem.save();

  if (req.body.replicateToLocations && Array.isArray(req.body.replicateToLocations)) {
    const locationsToReplicate = req.body.replicateToLocations.filter(id => id !== classItem.locationId?.toString());
    for (const locId of locationsToReplicate) {
      if (mongoose.Types.ObjectId.isValid(locId)) {
        // Check if a class with the same title already exists in that location to avoid duplicates
        const existing = await ClassModel.findOne({ title: saved.title, locationId: locId, isUAT: req.isUAT || false });
        if (!existing) {
          const newClassObj = saved.toObject();
          delete newClassObj._id;
          delete newClassObj.createdAt;
          delete newClassObj.updatedAt;
          newClassObj.locationId = locId;
          await ClassModel.create(newClassObj);
        } else {
          // If it exists, update it to match the current edits
          Object.assign(existing, req.body);
          existing.locationId = locId; // ensure location remains correct
          await existing.save();
        }
      }
    }
  }

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
