import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
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
import Invoice from '../models/Invoice.js';
import Lead from '../models/Lead.js';
import ExtensionRequest from '../models/ExtensionRequest.js';
import Expense from '../models/Expense.js';
import { resolveReadLocationId, resolveReadLocationIds } from '../utils/locationScope.js';
import { withUAT } from '../middleware/uatMiddleware.js';

export const getSummary = asyncHandler(async (req, res) => {
  const now = new Date();
  const locationId = resolveReadLocationId(req);
  const locationFilter = locationId && locationId !== '000000000000000000000000' && mongoose.Types.ObjectId.isValid(locationId) 
    ? { locationId: new mongoose.Types.ObjectId(locationId) } 
    : (locationId ? { locationId } : {});

  const strLocationFilter = locationId ? { locationId } : {};

  // Fetch fresh user to get latest seenAt timestamps
  const currentUser = await User.findById(req.user._id).select('seenAt').lean();
  const sa = currentUser?.seenAt || {};

  const [
    classCount,
    trainerCount,
    sessionUpcoming,
    bookingTotals,
    userTotal,
    adminCount,
    membershipActive,
    payments,
    pendingTrials,
    pendingLeads,
    pendingExtensions,
    pendingPayments,
    pendingBookings
  ] = await Promise.all([
    ClassModel.countDocuments(withUAT(req, strLocationFilter)),
    Trainer.countDocuments(withUAT(req, strLocationFilter)),
    Session.countDocuments(withUAT(req, { ...strLocationFilter, status: { $ne: 'cancelled' }, startTime: { $gte: now } })),
    Booking.aggregate([
      { $match: withUAT(req, locationFilter) },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    User.countDocuments(withUAT(req, strLocationFilter)),
    User.countDocuments(withUAT(req, { ...strLocationFilter, role: { $in: ['admin', 'superadmin'] } })),
    Membership.countDocuments(withUAT(req, { ...strLocationFilter, status: 'active' })),
    Payment.aggregate([
      { $match: withUAT(req, locationFilter) },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Trial.countDocuments(withUAT(req, {
      ...strLocationFilter,
      status: 'pending',
      ...(sa.trials ? { createdAt: { $gt: sa.trials } } : {})
    })),
    Lead.countDocuments(withUAT(req, {
      ...locationFilter,
      status: 'pending',
      ...(sa.leads ? { createdAt: { $gt: sa.leads } } : {})
    })),
    ExtensionRequest.countDocuments(withUAT(req, {
      ...locationFilter,
      status: 'pending',
      ...(sa.extensions ? { createdAt: { $gt: sa.extensions } } : {})
    })),
    Payment.countDocuments(withUAT(req, {
      ...locationFilter,
      status: 'pending',
      ...(sa.payments ? { createdAt: { $gt: sa.payments } } : {})
    })),
    Booking.countDocuments(withUAT(req, {
      ...locationFilter,
      status: 'pending',
      ...(sa.bookings ? { createdAt: { $gt: sa.bookings } } : {})
    }))
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
      count: paymentSummary.count,
      pending: pendingPayments
    },
    pendingCounts: {
      trials: pendingTrials,
      leads: pendingLeads,
      extensions: pendingExtensions,
      bookings: pendingBookings,
      payments: pendingPayments
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
  
  // Always enforce location access control
  const allowedLocationIds = resolveReadLocationIds(req);
  
  if (all !== 'true' && queryLocationId) {
    if (allowedLocationIds && !allowedLocationIds.includes(queryLocationId) && queryLocationId !== '000000000000000000000000') {
       filter.locationId = '000000000000000000000000'; // user requested a location they don't have access to
    } else {
       filter.locationId = queryLocationId;
    }
  } else {
    // If 'all' is true, or no queryLocationId is provided, fallback to all allowed locations
    if (allowedLocationIds && allowedLocationIds.length > 0) {
       filter.locationId = { $in: allowedLocationIds };
    } else if (req.user?.role !== 'superadmin') {
       filter.locationId = '000000000000000000000000';
    }
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

    case 'trainers': {
      // Trainers have locationIds (array)
      const trainerFilter = { ...filter };
      if (trainerFilter.locationId) {
        trainerFilter.locationIds = trainerFilter.locationId;
        delete trainerFilter.locationId;
      }
      const rawTrainers = await Trainer.find(trainerFilter)
        .populate('locationIds', 'name')
        .sort({ createdAt: -1 })
        .lean();
      data = rawTrainers.map(t => ({
        ...t,
        locationId: t.locationIds && t.locationIds.length > 0 ? t.locationIds[0] : null
      }));
      break;
    }

    case 'pricing':
      data = await Plan.find(filter)
        .populate('locationId', 'name')
        .sort({ createdAt: -1 })
        .lean();
      break;

    case 'bookings': {
      // For bookings, we might want to filter by 'date' instead of 'createdAt' for the actual class date
      const bookingDateFilter = {};
      const attendanceDateFilter = {};
      if (sDate && eDate) {
        bookingDateFilter.date = { $gte: sDate, $lte: eDate };
        attendanceDateFilter.checkedInAt = { $gte: sDate, $lte: eDate };
      }

      const [bookings, membershipSessions] = await Promise.all([
        Booking.find({ ...filter, ...bookingDateFilter })
          .populate('userId', 'name email phone')
          .populate('classId', 'title capacity price')
          .populate('planId', 'name')
          .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
          .populate('promotionId', 'name')
          .populate('locationId', 'name')
          .populate('processedBy', 'name')
          .sort({ date: -1 })
          .lean(),
        Session.find({
          ...filter,
          startTime: { $gte: sDate || new Date(0), $lte: eDate || new Date(9999, 11, 31) },
          classType: 'Plan'
        })
          .populate('trainerId', 'name')
          .populate('classId', 'title')
          .populate({
            path: 'membershipId',
            populate: { path: 'userId', select: 'name email phone' }
          })
          .populate('locationId', 'name')
          .sort({ startTime: -1 })
          .lean()
      ]);

      // Enrich Purchases
      const purchases = bookings.map(b => {
        if (b.bookingType === 'package' && b.planId) {
          b.classId = { ...b.classId, title: `${b.planId.name} (Package)` };
        }
        return b;
      });

      // Enrich Membership Sessions
      const now = new Date();
      const sessions = membershipSessions.map(sess => {
        const isUpcoming = new Date(sess.startTime) > now;
        return {
          _id: sess._id,
          bookingNumber: sess.membershipId?.bookingNumber || 'N/A',
          userId: sess.membershipId?.userId,
          participants: sess.membershipId?.childId ? [{ name: sess.membershipId.childId.name }] : [{ name: 'N/A' }],
          classId: sess.classId || { title: 'Membership Session' },
          sessionId: { trainerId: sess.trainerId },
          date: sess.startTime,
          slotTiming: sess.startTime,
          totalAmount: 0,
          status: isUpcoming ? 'UPCOMING' : (sess.attendanceStatus === 'present' ? 'PRESENT' : 'PAST'),
          paymentStatus: 'completed',
          method: sess.attendanceStatus || 'scheduled',
          locationId: sess.locationId
        };
      }).sort((a, b) => new Date(b.date) - new Date(a.date));

      data = { purchases, sessions };
      break;
    }

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

    case 'users': {
      // Fetch regular users (parents and customers), not admins
      const rawUsers = await User.find({ ...filter, ...dateFilter, role: { $in: ['parent', 'customer'] } })
        .select('-password')
        .populate('locationId', 'name')
        .populate('locationIds', 'name')
        .sort({ createdAt: -1 })
        .lean();

      data = await Promise.all(rawUsers.map(async u => {
        let resolvedLocation = u.locationId;
        if (!resolvedLocation && u.locationIds && u.locationIds.length > 0) {
          resolvedLocation = u.locationIds[0];
        }

        const children = await Child.find({ parentId: u._id }).select('name gender').lean();
        const childrenNames = children.map(c => {
          const genderStr = c.gender ? ` (${c.gender.charAt(0).toUpperCase() + c.gender.slice(1)})` : '';
          return `${c.name}${genderStr}`;
        }).join(', ');

        return {
          ...u,
          locationId: resolvedLocation,
          children: childrenNames || 'None'
        };
      }));
      break;
    }

    case 'staff': {
      const staffFilter = { ...filter, role: { $nin: ['parent', 'customer'] } };
      if (staffFilter.locationId) {
        const locId = staffFilter.locationId;
        delete staffFilter.locationId;
        staffFilter.$or = [
          { locationId: locId },
          { locationIds: locId }
        ];
      }

      const rawStaff = await User.find(withUAT(req, { ...staffFilter, ...dateFilter }))
        .select('-password')
        .populate('locationId', 'name')
        .populate('locationIds', 'name')
        .sort({ createdAt: -1 })
        .lean();

      data = rawStaff.map(s => {
        let resolvedLocation = s.locationId;
        if (!resolvedLocation && s.locationIds && s.locationIds.length > 0) {
          resolvedLocation = s.locationIds[0];
        }

        return {
          ...s,
          locationId: resolvedLocation
        };
      });
      break;
    }

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

    case 'attendance': {
      const attendanceDateFilter = {};
      if (sDate && eDate) {
        attendanceDateFilter.checkedInAt = {
          $gte: sDate,
          $lte: eDate
        };
      }
      data = await Attendance.find({ ...filter, ...attendanceDateFilter })
        .populate('bookingId', 'bookingNumber')
        .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
        .populate('childId', 'name')
        .populate('userId', 'name email phone')
        .populate('locationId', 'name')
        .sort({ checkedInAt: -1 })
        .lean();
      break;
    }

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

    case 'taxes':
      // Fetch bookings with tax details
      const taxBookings = await Booking.find({ ...filter, ...dateFilter, taxAmount: { $gt: 0 } })
        .populate('userId', 'name email')
        .populate('classId', 'title')
        .populate('locationId', 'name')
        .populate('processedBy', 'name')
        .populate('taxId', 'name type value')
        .sort({ createdAt: -1 })
        .lean();

      data = taxBookings.map(b => ({
        ...b,
        customerName: b.userId?.name || 'Guest',
        itemName: b.classId?.title || 'Unknown Item',
        branchName: b.locationId?.name || 'N/A',
        cashierName: b.processedBy?.name || 'System',
        taxName: b.taxId?.name || 'VAT',
        taxRate: b.taxId ? `${b.taxId.value}${b.taxId.type === 'percentage' ? '%' : ' AED'}` : 'N/A',
        baseAmount: (b.totalAmount || 0) - (b.taxAmount || 0),
        taxCollected: b.taxAmount || 0,
        totalPaid: b.totalAmount || 0,
        date: b.createdAt
      }));
      break;

    case 'membership_consumption': {
      const memberships = await Membership.find(filter)
        .populate('userId', 'name email phone')
        .populate('planId', 'name classesIncluded')
        .populate('childId', 'name')
        .populate('locationId', 'name')
        .sort({ createdAt: -1 })
        .lean();

      data = await Promise.all(memberships.map(async (m) => {
        const attendanceCount = await Attendance.countDocuments({
          membershipId: m._id,
          status: { $in: ['present', 'late'] }
        });

        const total = m.planId?.classesIncluded || 0;
        const remaining = m.classesRemaining === -1 ? 'Unlimited' : m.classesRemaining;
        const used = attendanceCount;

        return {
          ...m,
          parentName: m.userId?.name || 'Unknown',
          childName: m.childId?.name || 'Unknown',
          planName: m.planId?.name || 'N/A',
          locationName: m.locationId?.name || 'N/A',
          totalSessions: total === 0 ? 'Unlimited' : total,
          sessionsUsed: used,
          sessionsRemaining: remaining,
          consumptionPercentage: total > 0 ? Math.round((used / total) * 100) : (m.classesRemaining === -1 ? 100 : 0),
          expiryDate: m.endDate
        };
      }));
      break;
    }

    case 'sales_report': {
      const payments = await Payment.find({ ...filter, ...dateFilter, status: 'paid' }).sort({ createdAt: -1 });
      const dailyMap = {};
      const monthlyMap = {};

      payments.forEach(p => {
        const day = p.createdAt.toISOString().slice(0, 10);
        const month = p.createdAt.toISOString().slice(0, 7);

        if (!dailyMap[day]) dailyMap[day] = { date: day, type: 'Daily', amount: 0, transactions: 0 };
        dailyMap[day].amount += (p.amount || 0);
        dailyMap[day].transactions += 1;

        if (!monthlyMap[month]) monthlyMap[month] = { date: month, type: 'Monthly', amount: 0, transactions: 0 };
        monthlyMap[month].amount += (p.amount || 0);
        monthlyMap[month].transactions += 1;
      });

      // Combine and sort
      data = [
        ...Object.values(monthlyMap).map(m => ({ ...m, dateDisplay: new Date(m.date + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) })),
        ...Object.values(dailyMap).map(d => ({ ...d, dateDisplay: new Date(d.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }))
      ].sort((a, b) => b.date.localeCompare(a.date));
      break;
    }

    case 'detailed_sales': {
      // Fetch invoices with all related data
      const invoices = await Invoice.find({ ...filter, ...dateFilter, status: 'paid' })
        .populate('userId', 'name email phone')
        .populate('locationId', 'name')
        .populate('bookingId', 'paymentMethod bookingNumber')
        .sort({ date: -1 })
        .lean();

      const lineItems = [];
      invoices.forEach(inv => {
        const customerName = inv.userId?.name || inv.guestDetails?.name || 'Guest';
        const customerEmail = inv.userId?.email || inv.guestDetails?.email || 'N/A';
        const customerPhone = inv.userId?.phone || inv.guestDetails?.phone || 'N/A';
        const location = inv.locationId?.name || 'N/A';
        const rawMethod = inv.bookingId?.paymentMethod || 'N/A';
        let paymentSource = 'N/A';
        let paymentMode = 'N/A';

        if (rawMethod.toLowerCase().includes('online') || rawMethod.toLowerCase().includes('website')) {
          paymentSource = 'WEBSITE';
          paymentMode = 'ONLINE';
        } else {
          paymentSource = 'CENTER';
          let cleaned = rawMethod.toLowerCase()
            .replace('center_', '')
            .replace('pay_at_', '')
            .replace('pay_at', '')
            .trim();
          paymentMode = (cleaned === 'center' || !cleaned) ? 'CASH' : cleaned.toUpperCase();
        }
        const bookingNumber = inv.bookingId?.bookingNumber || 'N/A';

        const safeItems = Array.isArray(inv.items) ? inv.items : [];

        safeItems.forEach(item => {
          lineItems.push({
            location,
            invoiceNumber: inv.invoiceNumber || 'N/A',
            bookingNumber,
            invoiceDate: inv.date,
            customerName,
            customerPhone,
            customerEmail,
            item: item.description || 'Service',
            unitPrice: item.unitPrice || 0,
            quantity: item.quantity || 1,
            lineTotal: item.total || 0,
            lineVat: item.taxAmount || 0,
            discount: (inv.discountAmount || 0) + (inv.couponAmount || 0),
            discountType: inv.couponCode ? `Coupon (${inv.couponCode})` : ((inv.discountAmount || 0) > 0 ? 'Promo' : 'None'),
            totalAmount: inv.totalAmount || 0,
            paymentSource,
            paymentMode
          });
        });
      });
      data = lineItems;
      break;
    }

    case 'profit_loss': {
      // 1. Get Revenues (Payments with status = paid)
      const payments = await Payment.find({ ...filter, ...dateFilter, status: 'paid' })
        .populate('userId', 'name email')
        .populate('locationId', 'name')
        .populate('bookingId', 'bookingNumber')
        .sort({ createdAt: -1 })
        .lean();

      // 2. Get Expenses
      let expenseDateFilter = {};
      if (sDate && eDate) {
        expenseDateFilter.date = { $gte: sDate, $lte: eDate };
      } else if (sDate) {
        expenseDateFilter.date = { $gte: sDate };
      } else if (eDate) {
        expenseDateFilter.date = { $lte: eDate };
      }

      const expenses = await Expense.find({ ...filter, ...expenseDateFilter, isUat: req.isUat === true })
        .populate('locationId', 'name')
        .sort({ date: -1 })
        .lean();

      // Format data for response
      data = {
        revenues: payments.map(p => ({
          _id: p._id,
          date: p.createdAt,
          amount: p.amount,
          source: p.paymentMethod,
          type: p.paymentType || 'Sales',
          customerName: p.userId?.name || 'Guest',
          location: p.locationId?.name || 'N/A',
          bookingNumber: p.bookingId?.bookingNumber || (p.groupId ? 'Group Booking' : 'N/A'),
          bookingId: p.bookingId?._id || null,
          groupId: p.groupId || null
        })),
        expenses: expenses.map(e => ({
          _id: e._id,
          date: e.date,
          amount: e.amount,
          category: e.category,
          title: e.title,
          location: e.locationId?.name || 'N/A'
        }))
      };
      break;
    }

    case 'expenses': {
      let expenseDateFilter = {};
      if (sDate && eDate) {
        expenseDateFilter.date = { $gte: sDate, $lte: eDate };
      } else if (sDate) {
        expenseDateFilter.date = { $gte: sDate };
      } else if (eDate) {
        expenseDateFilter.date = { $lte: eDate };
      }

      const expenses = await Expense.find({ ...filter, ...expenseDateFilter, isUat: req.isUat === true })
        .populate('locationId', 'name')
        .sort({ date: -1 })
        .lean();

      data = expenses.map(e => ({
        _id: e._id,
        date: e.date,
        amount: e.amount,
        category: e.category,
        title: e.title,
        location: e.locationId?.name || 'N/A'
      }));
      break;
    }

    default:
      res.status(400);
      throw new Error('Invalid report type');
  }

  res.json(data);
});
