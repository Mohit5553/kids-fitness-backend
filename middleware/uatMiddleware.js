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
export const withUAT = (req, filter = {}) => {
  if (req.isUAT) {
    return { ...filter, isUAT: true };
  }
  
  // For Live mode, include records where isUAT is false OR missing
  return {
    ...filter,
    $or: [
      { isUAT: false },
      { isUAT: { $exists: false } }
    ]
  };
};
