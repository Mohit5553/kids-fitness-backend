export const resolveReadLocationId = (req) => {
  const isSuperadmin = req.user?.role === 'superadmin';

  if (isSuperadmin) {
    return req.locationId ? req.locationId.toString() : null;
  }

  const allowedIds = [];
  if (req.user?.locationIds && req.user.locationIds.length > 0) {
    allowedIds.push(...req.user.locationIds.map(id => id.toString()));
  }
  if (req.user?.locationId) {
    if (!allowedIds.includes(req.user.locationId.toString())) {
      allowedIds.push(req.user.locationId.toString());
    }
  }

  // If a specific location is requested, check if allowed
  if (req.locationId && allowedIds.includes(req.locationId.toString())) {
    return req.locationId.toString();
  }

  // If no specific location requested, or requested one is not allowed, return their first allowed location
  return allowedIds.length > 0 ? allowedIds[0] : '000000000000000000000000';
};

export const resolveReadLocationIds = (req) => {
  const isSuperadmin = req.user?.role === 'superadmin';

  const allowedIds = [];
  if (req.user?.locationIds && req.user.locationIds.length > 0) {
    allowedIds.push(...req.user.locationIds.map(id => id.toString()));
  }
  if (req.user?.locationId) {
    if (!allowedIds.includes(req.user.locationId.toString())) {
      allowedIds.push(req.user.locationId.toString());
    }
  }

  if (isSuperadmin) {
    return req.locationId ? [req.locationId.toString()] : null;
  }

  if (req.locationId) {
    if (allowedIds.includes(req.locationId.toString())) {
      return [req.locationId.toString()];
    } else {
      return ['000000000000000000000000']; // Not authorized for this location
    }
  }

  return allowedIds.length > 0 ? allowedIds : ['000000000000000000000000'];
};

export const resolveWriteLocationId = (req) => {
  if (req.user?.role === 'superadmin' && req.body?.locationIds && req.body.locationIds.length > 0) {
    return req.body.locationIds[0];
  }
  return req.locationId || (req.user?.locationIds && req.user.locationIds.length > 0 ? req.user.locationIds[0] : null);
};

export const requireLocationId = (req) => {
  const locationId = resolveWriteLocationId(req);
  if (!locationId) {
    throw new Error('Location is required');
  }
  return locationId;
};
