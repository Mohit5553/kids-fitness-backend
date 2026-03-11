import asyncHandler from 'express-async-handler';
import ClassModel from '../models/Class.js';
import Trainer from '../models/Trainer.js';
import Session from '../models/Session.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Membership from '../models/Membership.js';
import Payment from '../models/Payment.js';
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
