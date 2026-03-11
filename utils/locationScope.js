export const resolveReadLocationId = (req) => {
  return req.locationId || req.user?.locationId || null;
};

export const resolveWriteLocationId = (req) => {
  if (req.user?.role === 'superadmin' && req.body?.locationId) {
    return req.body.locationId;
  }
  return req.locationId || req.user?.locationId || null;
};

export const requireLocationId = (req) => {
  const locationId = resolveWriteLocationId(req);
  if (!locationId) {
    throw new Error('Location is required');
  }
  return locationId;
};
