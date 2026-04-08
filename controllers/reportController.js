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
import Attendance from '../models/Attendance.js';
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
    Session.countDocuments({ ...locationFilter, status: { $ne: 'cancelled' }, startTime: { $gte: now } }),
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
  const { startDate, endDate, locationId: queryLocationId, all } = req.query;
  
  const filter = {};
  // If 'all' is true, we don't apply location filter. 
  // If queryLocationId is provided, we use it.
  // Otherwise, we use the default resolveReadLocationId (which might restrict to one branch).
  if (all !== 'true') {
    const locationId = queryLocationId || resolveReadLocationId(req);
    if (locationId) filter.locationId = locationId;
  }
  
  const dateFilter = {};
  const sDate = startDate ? new Date(startDate) : null;
  const eDate = endDate ? new Date(endDate) : null;
  if (eDate) eDate.setHours(23, 59, 59, 999);

  if (sDate && eDate) {
    dateFilter.createdAt = {
      $gte: sDate,
      $lte: eDate
    };
  } else if (sDate) {
    dateFilter.createdAt = { $gte: sDate };
  } else if (eDate) {
    dateFilter.createdAt = { $lte: eDate };
  }

  let data = [];

  switch (type) {
    case 'classes':
      data = await ClassModel.find(filter)
        .populate('availableTrainers', 'name')
        .populate('locationId', 'name')
        .sort({ createdAt: -1 })
        .lean();
      // Enrich with session/booking counts if needed, but for simplicity we'll return basic data first
      break;

    case 'trainers':
      data = await Trainer.find(filter)
        .populate('locationId', 'name')
        .sort({ createdAt: -1 })
        .lean();
      break;

    case 'pricing':
      data = await Plan.find(filter)
        .populate('locationId', 'name')
        .sort({ createdAt: -1 })
        .lean();
      break;

    case 'bookings':
      // For bookings, we might want to filter by 'date' instead of 'createdAt' for the actual class date
      const bookingDateFilter = {};
      if (sDate && eDate) {
        bookingDateFilter.date = {
          $gte: sDate,
          $lte: eDate
        };
      }
      data = await Booking.find({ ...filter, ...bookingDateFilter })
        .populate('userId', 'name email phone')
        .populate('classId', 'title capacity')
        .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
        .populate('locationId', 'name')
        .populate('promotionId', 'name')
        .populate('processedBy', 'name')
        .sort({ date: -1 })
        .lean();
      break;

    case 'trials':
      data = await Trial.find({ ...filter, ...dateFilter })
        .populate('locationId', 'name')
        .sort({ createdAt: -1 })
        .lean();
      break;

    case 'payments':
      data = await Payment.find({ ...filter, ...dateFilter })
        .populate('userId', 'name email')
        .populate('locationId', 'name')
        .populate('promotionId', 'name')
        .populate('processedBy', 'name')
        .sort({ createdAt: -1 })
        .lean();
      break;

    case 'users':
      // Fetch regular users (parents and customers), not admins
      data = await User.find({ ...filter, ...dateFilter, role: { $in: ['parent', 'customer'] } })
        .populate('locationId', 'name')
        .sort({ createdAt: -1 })
        .lean();
      break;

    case 'trainer_sales':
      // This report shows sessions and counts bookings/revenue per session
      const sessionFilter = { ...filter };
      if (sDate && eDate) {
        sessionFilter.startTime = {
          $gte: sDate,
          $lte: eDate
        };
      }

      const sessions = await Session.find(sessionFilter)
        .populate('classId', 'title')
        .populate('trainerId', 'name')
        .populate('locationId', 'name')
        .sort({ startTime: -1 })
        .lean();

      // For each session, find confirmed bookings and sum revenue
      data = await Promise.all(sessions.map(async (s) => {
        const bookings = await Booking.find({ sessionId: s._id, status: 'confirmed' });
        const totalSales = bookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
        const bookingCount = bookings.reduce((sum, b) => sum + (b.participants?.length || 1), 0);
        
        return {
          ...s,
          classTitle: s.classId?.title || 'N/A',
          trainerName: s.trainerId?.name || 'TBA',
          branchName: s.locationId?.name || 'N/A',
          date: s.startTime,
          bookingsCount: bookingCount,
          totalRevenue: totalSales,
          sessionStatus: new Date(s.startTime) < new Date() ? 'Closed' : 'Open'
        };
      }));
      break;

      data = await Attendance.find({ ...filter, ...attendanceDateFilter })
        .populate('bookingId', 'bookingNumber')
        .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
        .populate('childId', 'name')
        .populate('userId', 'name email phone')
        .populate('locationId', 'name')
        .sort({ checkedInAt: -1 })
        .lean();
      break;

    case 'promotions_usage':
      // Aggregate usage per promotion
      const paymentsWithPromos = await Payment.find({ ...filter, ...dateFilter, promotionId: { $exists: true } })
        .populate('promotionId', 'name promoType')
        .populate('userId', 'name')
        .populate('locationId', 'name')
        .populate('processedBy', 'name')
        .sort({ createdAt: -1 })
        .lean();
        
      data = paymentsWithPromos.map(p => ({
        ...p,
        promoName: p.promotionId?.name || 'Unknown',
        promoType: p.promotionId?.promoType || 'N/A',
        customerName: p.userId?.name || 'Guest',
        branchName: p.locationId?.name || 'N/A',
        cashierName: p.processedBy?.name || 'System',
        discount: p.discountAmount || 0,
        finalAmount: p.amount,
        date: p.createdAt
      }));
      break;

    default:
      res.status(400);
      throw new Error('Invalid report type');
  }

  res.json(data);
});
