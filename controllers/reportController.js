import asyncHandler from 'express-async-handler';
import ClassModel from '../models/Class.js';
import Trainer from '../models/Trainer.js';
import Session from '../models/Session.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Membership from '../models/Membership.js';
import Payment from '../models/Payment.js';
import Child from '../models/Child.js';
import Plan from '../models/Plan.js';
import Trial from '../models/Trial.js';
import { resolveReadLocationId } from '../utils/locationScope.js';

export const getSummary = asyncHandler(async (req, res) => {
  const now = new Date();
  const locationId = resolveReadLocationId(req);
  const locationFilter = locationId ? { locationId } : {};

  const [
    classCount,
    trainerCount,
    sessionUpcoming,
    bookingTotals,
    userTotal,
    adminCount,
    membershipActive,
    payments
  ] = await Promise.all([
    ClassModel.countDocuments(locationFilter),
    Trainer.countDocuments(locationFilter),
    Session.countDocuments({ ...locationFilter, startTime: { $gte: now } }),
    Booking.aggregate([
      ...(locationId ? [{ $match: { locationId } }] : []),
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    User.countDocuments(locationFilter),
    User.countDocuments({ ...locationFilter, role: { $in: ['admin', 'superadmin'] } }),
    Membership.countDocuments({ ...locationFilter, status: 'active' }),
    Payment.aggregate([
      ...(locationId ? [{ $match: { locationId } }] : []),
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ])
  ]);

  const bookingSummary = bookingTotals.reduce(
    (acc, item) => ({ ...acc, [item._id]: item.count }),
    { pending: 0, confirmed: 0, cancelled: 0 }
  );

  const paymentSummary = payments[0] || { total: 0, count: 0 };

  res.json({
    classes: classCount,
    trainers: trainerCount,
    upcomingSessions: sessionUpcoming,
    bookings: bookingSummary,
    users: {
      total: userTotal,
      admins: adminCount,
      parents: userTotal - adminCount
    },
    memberships: {
      active: membershipActive
    },
    payments: {
      totalAmount: paymentSummary.total,
      count: paymentSummary.count
    }
  });
});

export const getParentSummary = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const now = new Date();

  const [childrenCount, upcomingClassesCount, latestMembership] = await Promise.all([
    Child.countDocuments({ parentId: userId }),
    Booking.countDocuments({ 
      userId, 
      status: 'confirmed', 
      date: { $gte: now } 
    }),
    Membership.findOne({ userId }).sort({ createdAt: -1 })
  ]);

  res.json({
    childrenCount,
    upcomingClassesCount,
    membershipStatus: latestMembership ? (latestMembership.status.charAt(0).toUpperCase() + latestMembership.status.slice(1)) : 'None'
  });
});

// @desc    Get detailed reports
// @route   GET /api/reports/:type
// @access  Private/Admin
export const getDetailedReport = asyncHandler(async (req, res) => {
  const { type } = req.params;
  const { startDate, endDate, locationId: queryLocationId } = req.query;
  const locationId = queryLocationId || resolveReadLocationId(req);
  
  const filter = {};
  if (locationId) filter.locationId = locationId;
  
  const dateFilter = {};
  if (startDate && endDate) {
    dateFilter.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  } else if (startDate) {
    dateFilter.createdAt = { $gte: new Date(startDate) };
  } else if (endDate) {
    dateFilter.createdAt = { $lte: new Date(endDate) };
  }

  let data = [];

  switch (type) {
    case 'classes':
      data = await ClassModel.find(filter).populate('availableTrainers', 'name').sort({ createdAt: -1 }).lean();
      // Enrich with session/booking counts if needed, but for simplicity we'll return basic data first
      break;

    case 'trainers':
      data = await Trainer.find(filter).sort({ createdAt: -1 }).lean();
      break;

    case 'pricing':
      data = await Plan.find(filter).sort({ createdAt: -1 }).lean();
      break;

    case 'bookings':
      // For bookings, we might want to filter by 'date' instead of 'createdAt' for the actual class date
      const bookingDateFilter = {};
      if (startDate && endDate) {
        bookingDateFilter.date = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }
      data = await Booking.find({ ...filter, ...bookingDateFilter })
        .populate('userId', 'name email phone')
        .populate('classId', 'title')
        .populate('locationId', 'name')
        .sort({ date: -1 })
        .lean();
      break;

    case 'trials':
      data = await Trial.find({ ...filter, ...dateFilter }).sort({ createdAt: -1 }).lean();
      break;

    case 'payments':
      data = await Payment.find({ ...filter, ...dateFilter })
        .populate('userId', 'name email')
        .populate('locationId', 'name')
        .sort({ createdAt: -1 })
        .lean();
      break;

    case 'users':
      // Fetch only regular users (parents), not admins
      data = await User.find({ ...filter, ...dateFilter, role: 'user' })
        .sort({ createdAt: -1 })
        .lean();
      break;

    default:
      res.status(400);
      throw new Error('Invalid report type');
  }

  res.json(data);
});
