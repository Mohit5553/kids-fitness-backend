import asyncHandler from 'express-async-handler';

/**
 * Middleware to detect the system mode (UAT vs LIVE) from headers.
 * Attaches isUAT boolean to the request object.
 */
export const uatDetector = asyncHandler(async (req, res, next) => {
  const mode = req.headers['x-system-mode'] || 'live';
  req.isUAT = mode === 'uat';
  next();
});

/**
 * Helper to inject isUAT filter into Mongoose queries.
 * Use this in controllers: Session.find(withUAT(req, { ...otherFilters }))
 */
export const withUAT = (req, filter = {}, allowLiveInUAT = false) => {
  if (req.isUAT && allowLiveInUAT) {
    return filter;
  }

  const uatFilter = req.isUAT 
    ? { isUAT: true } 
    : { $or: [{ isUAT: false }, { isUAT: { $exists: false } }] };

  // If filter already has an $or, we must use $and to merge them
  if (filter.$or) {
    return {
      $and: [
        filter,
        uatFilter
      ]
    };
  }

  return {
    ...filter,
    ...uatFilter
  };
};
