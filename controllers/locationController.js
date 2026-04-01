import asyncHandler from 'express-async-handler';
import Location from '../models/Location.js';
import ClassModel from '../models/Class.js';
import Session from '../models/Session.js';
import { resolveReadLocationId } from '../utils/locationScope.js';

export const getLocations = asyncHandler(async (req, res) => {
  const query = req.query.all === 'true' ? {} : { status: 'active' };

  if (req.query.activeClasses === 'true') {
    const { classId } = req.query;
    let activeLocationIds;

    if (classId) {
      // Find locations specifically for this class
      const classItem = await ClassModel.findById(classId);
      const classLocations = classItem?.locationId ? [classItem.locationId] : [];
      const sessionLocations = await Session.distinct('locationId', { classId });
      
      activeLocationIds = [...new Set([...classLocations, ...sessionLocations].map(id => id?.toString()).filter(Boolean))];
    } else {
      // Find locations that have either classes assigned or sessions scheduled (general)
      const classLocations = await ClassModel.distinct('locationId');
      const sessionLocations = await Session.distinct('locationId');
      activeLocationIds = [...new Set([...classLocations, ...sessionLocations].map(id => id?.toString()).filter(Boolean))];
    }
    
    query._id = { $in: activeLocationIds };
  }

  const locations = await Location.find(query).sort({ sortOrder: 1, name: 1 });
  res.json(locations);
});

export const getLocationById = asyncHandler(async (req, res) => {
  const location = await Location.findById(req.params.id);
  if (!location) {
    res.status(404);
    throw new Error('Location not found');
  }
  res.json(location);
});

export const createLocation = asyncHandler(async (req, res) => {
  const { name, slug, address, city, country, phone, email, timezone, imageUrl, isOnline, status, sortOrder } = req.body;
  if (!name || !slug) {
    res.status(400);
    throw new Error('Name and slug are required');
  }
  const created = await Location.create({
    name,
    slug: slug.toLowerCase(),
    address,
    city,
    country,
    phone,
    email,
    timezone,
    imageUrl,
    isOnline,
    status,
    sortOrder
  });
  res.status(201).json(created);
});

export const updateLocation = asyncHandler(async (req, res) => {
  const location = await Location.findById(req.params.id);
  if (!location) {
    res.status(404);
    throw new Error('Location not found');
  }
  Object.assign(location, req.body);
  if (location.slug) {
    location.slug = location.slug.toLowerCase();
  }
  const saved = await location.save();
  res.json(saved);
});

export const deleteLocation = asyncHandler(async (req, res) => {
  const location = await Location.findById(req.params.id);
  if (!location) {
    res.status(404);
    throw new Error('Location not found');
  }

  // Dependency Check: Block if active Classes or scheduled Sessions are linked.
  const ClassModel = mongoose.model('Class');
  const Session = mongoose.model('Session');

  const [classCount, sessionCount] = await Promise.all([
    ClassModel.countDocuments({ locationId: location._id, status: 'active' }),
    Session.countDocuments({ locationId: location._id, status: 'scheduled' })
  ]);

  if (classCount > 0 || sessionCount > 0) {
    res.status(400);
    throw new Error(`Cannot disable branch: There are ${classCount} active classes and ${sessionCount} scheduled sessions at this location. Please reassign or cancel them first.`);
  }

  // Toggle status
  location.status = location.status === 'active' ? 'inactive' : 'active';
  await location.save();

  res.json({ message: `Branch status updated to ${location.status}`, status: location.status });
});

export const getMyLocation = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  if (!locationId) {
    return res.json(null);
  }
  const location = await Location.findById(locationId);
  res.json(location);
});
