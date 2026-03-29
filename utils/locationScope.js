export const resolveReadLocationId = (req) => {
  if (req.locationId) return req.locationId;
  if (req.user?.locationIds && req.user.locationIds.length > 0) {
    return req.user.locationIds[0];
  }
  return req.user?.locationId || null;
};

export const resolveReadLocationIds = (req) => {
  if (req.locationId) return [req.locationId];
  const ids = [];
  if (req.user?.locationIds && req.user.locationIds.length > 0) {
    ids.push(...req.user.locationIds);
  }
  if (req.user?.locationId) {
    if (!ids.includes(req.user.locationId.toString())) {
      ids.push(req.user.locationId);
    }
  }
  return ids.length > 0 ? ids : null;
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
