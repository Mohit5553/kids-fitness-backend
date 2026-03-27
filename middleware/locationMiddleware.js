import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Location from '../models/Location.js';

const isIpHost = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

const getSubdomain = (hostname) => {
  if (!hostname) return null;
  const host = hostname.split(':')[0];
  if (host === 'localhost' || isIpHost(host)) return null;
  const parts = host.split('.');
  if (parts.length < 3) return null;
  return parts[0];
};

export const locationMiddleware = asyncHandler(async (req, res, next) => {
  const headerId = req.headers['x-location-id'];
  const headerSlug = req.headers['x-location'];
  const querySlug = req.query.location;
  const hostnameSlug = getSubdomain(req.hostname);
  const fallbackSlug = process.env.DEFAULT_LOCATION_SLUG;

  let location = null;

  if (headerId && mongoose.Types.ObjectId.isValid(headerId)) {
    location = await Location.findById(headerId);
  } else {
    const slug = headerSlug || querySlug || hostnameSlug || fallbackSlug;
    if (slug) {
      location = await Location.findOne({ slug: slug.toLowerCase(), status: 'active' });
    }
  }

  if (location) {
    req.location = location;
    req.locationId = location._id;
  }

  next();
});
