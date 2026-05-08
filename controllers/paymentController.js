import asyncHandler from 'express-async-handler';
import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import ClassModel from '../models/Class.js';
import Plan from '../models/Plan.js';
import Membership from '../models/Membership.js';
import User from '../models/User.js';
import Invoice from '../models/Invoice.js';
import { toCsv } from '../utils/csv.js';
import { resolveReadLocationIds } from '../utils/locationScope.js';
import { sendPaymentConfirmationEmail } from '../utils/mailer.js';
import { linkUserBookings } from './bookingController.js';
import { withUAT } from '../middleware/uatMiddleware.js';

// Internal function to heal missing Payment records for any confirmed bookings
const syncPayments = async (user = null, req = {}) => {
  try {
    // 1. If user provided, run their guest linkage/healing first
    if (user) {
      await linkUserBookings(user);
    }

    // 0. Data Repair: Ensure existing healed payments have planId and locationId (enables cleanup and visibility)
    const incomplete = await Payment.find(withUAT(req, {
      bookingId: { $exists: true },
      $or: [{ planId: { $exists: false } }, { locationId: null }]
    })).populate('bookingId');
    for (const p of incomplete) {
      let changed = false;
      if (!p.planId && p.bookingId?.planId) {
        p.planId = p.bookingId.planId;
        changed = true;
      }
      if (!p.locationId && p.bookingId?.locationId) {
        p.locationId = p.bookingId.locationId;
        changed = true;
      }
      if (changed) await p.save();
    }

    // 2. Global Healing: Find ANY confirmed booking since March 24 missing a Payment record
    const startDate = new Date('2026-03-01'); 
    const missingBookings = await Booking.find(withUAT(req, {
      createdAt: { $gte: startDate }
    }));

    for (const b of missingBookings) {
      // Heal Payment records
      let exists = await Payment.findOne(withUAT(req, { 
        $or: [
          { bookingId: b._id },
          { groupId: b.groupId }
        ].filter(cond => cond.groupId !== undefined || cond.bookingId !== undefined)
      }));

      // 2. Heal Orphaned Plan Payments (Walking Bookings)
      if (!exists && b.bookingType === 'package' && b.planId) {
        // Look for a payment with same plan/user/amount created within 1 hour of the booking
        const timeLimit = new Date(b.createdAt);
        timeLimit.setHours(timeLimit.getHours() - 1);
        
        exists = await Payment.findOne(withUAT(req, {
          userId: b.userId,
          planId: b.planId,
          amount: b.totalAmount,
          bookingId: { $exists: false },
          createdAt: { $gte: timeLimit, $lte: new Date(b.createdAt.getTime() + 3600000) }
        }));

        if (exists) {
          exists.bookingId = b._id;
          if (exists.status === 'pending' && b.paymentStatus === 'completed') {
            exists.status = 'paid';
          }
          await exists.save();
        }
      }

      if (!exists) {
        await Payment.create({
          userId: b.userId,
          bookingId: b._id,
          groupId: b.groupId,
          amount: b.totalAmount,
          paymentMethod: b.paymentMethod || 'online',
          status: b.paymentStatus === 'completed' ? 'paid' : 'pending',
          locationId: b.locationId, 
          planId: b.planId, 
          membershipUnits: b.membershipUnits || 1,
          createdAt: b.createdAt,
          isUAT: b.isUAT || false
        });
      } else if (exists.status === 'pending') {
        exists.status = 'paid';
        await exists.save();
      }

      // Heal Invoice records: Ensure confirmed bookings have 'paid' invoices
      const invoiceRec = await Invoice.findOne(withUAT(req, { bookingId: b._id }));
      if (invoiceRec && invoiceRec.status === 'unpaid') {
        invoiceRec.status = 'paid';
        await invoiceRec.save();
      }
    }

    // 3. Aggressive Cleanup: Remove orphaned PENDING payments if a PAID one exists for the same booking/plan
    const orphanedPending = await Payment.find({
      status: 'pending',
      planId: { $exists: true },
      bookingId: { $exists: false }
    });

    for (const p of orphanedPending) {
      const confirmedMatch = await Payment.findOne({
        userId: p.userId,
        planId: p.planId,
        amount: p.amount,
        status: 'paid',
        bookingId: { $exists: true }
      });

      if (confirmedMatch) {
        // This is a duplicate created by the previous WalkingBooking bug
        await p.deleteOne();
      }
    }
  } catch (error) {
    console.error('Payment sync/healing failed:', error);
  }
};

export const getMyPayments = asyncHandler(async (req, res) => {
  // Sync/Heal before fetching to ensure latest guest bookings are linked
  await syncPayments(req.user);

  const payments = await Payment.find({ userId: req.user._id })
    .populate({
      path: 'bookingId',
      populate: [
        { path: 'classId', select: 'title price' },
        { path: 'sessionId', select: 'startTime endTime' }
      ]
    })
    .populate('planId', 'name price')
    .populate({
      path: 'membershipId',
      populate: { path: 'planId', select: 'name' }
    })
    .sort({ createdAt: -1 });

  const withInvoices = await Promise.all(payments.map(async (p) => {
    const pObj = p.toObject();
    if (p.bookingId) {
      const inv = await Invoice.findOne({ bookingId: p.bookingId._id }).select('invoiceNumber status amount');
      pObj.invoice = inv;
    }
    return pObj;
  }));

  res.json(withInvoices);
});

export const getPayments = asyncHandler(async (req, res) => {
  const { locationId: queryLocationId, startDate, endDate, all } = req.query;

  // 1. Sync/Heal before fetching
  await syncPayments(null, req);
  
  const locationIds = (queryLocationId && queryLocationId !== 'all') ? [queryLocationId] : resolveReadLocationIds(req);
  
  const filter = {};
  if (locationIds && locationIds.length > 0) {
    filter.locationId = { $in: locationIds };
  }
  
  if (startDate && endDate) {
    filter.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
    };
  }

  const payments = await Payment.find(withUAT(req, filter))
    .populate('userId', 'name email')
    .populate({
      path: 'bookingId',
      populate: [
        { path: 'classId', select: 'title price' },
        { path: 'sessionId', select: 'startTime endTime' }
      ]
    })
    .populate('planId', 'name price')
    .populate({
      path: 'membershipId',
      populate: { path: 'planId', select: 'name' }
    })
    .sort({ createdAt: -1 });

  const withInvoices = await Promise.all(payments.map(async (p) => {
    const pObj = p.toObject();
    if (p.bookingId) {
      const inv = await Invoice.findOne(withUAT(req, { bookingId: p.bookingId._id })).select('invoiceNumber status amount');
      pObj.invoice = inv;
    }
    return pObj;
  }));

  res.json(withInvoices);
});

export const getAllPayments = asyncHandler(async (req, res) => {
  // Run global sync/healing for admin view
  await syncPayments(null, req);

  const locationIds = resolveReadLocationIds(req);
  const filter = locationIds ? { locationId: { $in: locationIds } } : {};
  const payments = await Payment.find(withUAT(req, filter))
    .populate('userId', 'name email')
    .populate({
      path: 'bookingId',
      populate: [
        { path: 'classId', select: 'title price' },
        { path: 'sessionId', select: 'startTime endTime' }
      ]
    })
    .populate('planId', 'name price')
    .populate({
      path: 'membershipId',
      populate: { path: 'planId', select: 'name' }
    })
    .sort({ createdAt: -1 });

  const withInvoices = await Promise.all(payments.map(async (p) => {
    const pObj = p.toObject();
    if (p.bookingId) {
      const inv = await Invoice.findOne(withUAT(req, { bookingId: p.bookingId._id })).select('invoiceNumber status amount');
      pObj.invoice = inv;
    }
    return pObj;
  }));

  res.json(withInvoices);
});

export const createPayment = asyncHandler(async (req, res) => {
  const { bookingId, planId, membershipId, amount, paymentMethod, reference, last4, promotionId, discountAmount, couponAmount, couponCode, userId, processedBy, membershipUnits } = req.body;
  if (!amount) {
    res.status(400);
    throw new Error('Amount is required');
  }

  const isStaff = req.user && !['parent', 'customer'].includes((req.user.role || '').toLowerCase());
  const targetUserId = (isStaff && userId) ? userId : req.user._id;

  let locationId = null;
  if (bookingId) {
    const booking = await Booking.findById(bookingId);
    locationId = booking?.locationId || null;
  }
  if (!locationId && planId) {
    const plan = await Plan.findById(planId);
    locationId = plan?.locationId || null;
  }
  if (!locationId && membershipId) {
    const membership = await Membership.findById(membershipId);
    locationId = membership?.locationId || null;
  }

  const created = await Payment.create({
    userId: targetUserId,
    bookingId,
    planId,
    membershipId,
    amount,
    paymentMethod,
    status: req.body.status || (paymentMethod === 'center' ? 'pending' : 'paid'),
    reference,
    last4,
    locationId,
    promotionId,
    discountAmount,
    couponCode,
    couponAmount,
    membershipUnits,
    processedBy: processedBy || req.user._id
  });

  // Notify User
  const userData = await User.findById(created.userId);
  if (userData) {
    sendPaymentConfirmationEmail(created, userData).catch(err => console.error('Payment confirmation email failed:', err.message));
  }

  res.status(201).json(created);
});

export const createBookingPayment = asyncHandler(async (req, res) => {
  const { bookingId, paymentMethod, reference, last4, promotionId, discountAmount, couponAmount, couponCode } = req.body;
  if (!bookingId) {
    res.status(400);
    throw new Error('bookingId is required');
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }

  const classItem = await ClassModel.findById(booking.classId);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }

  const effectiveDiscount = Number(discountAmount ?? booking.discountAmount ?? 0) || 0;
  const effectiveCouponAmount = Number(couponAmount ?? booking.couponAmount ?? 0) || 0;
  const effectiveCouponCodeRaw = (couponCode ?? booking.couponCode ?? '').toString().trim();
  const effectiveCouponCode = effectiveCouponCodeRaw ? effectiveCouponCodeRaw.toUpperCase() : undefined;
  const bookingTotal = Number(booking.totalAmount || classItem.price || 0) || 0;

  const created = await Payment.create({
    userId: req.user._id,
    bookingId,
    amount: bookingTotal,
    paymentMethod: paymentMethod || 'card',
    status: 'paid',
    reference,
    last4,
    locationId: booking.locationId,
    promotionId,
    discountAmount: effectiveDiscount,
    couponCode: effectiveCouponCode,
    couponAmount: effectiveCouponAmount
  });

  booking.status = 'confirmed';
  booking.paymentStatus = 'completed';
  booking.paymentReference = reference;
  booking.paymentId = created._id;
  booking.paymentDate = new Date();
  booking.discountAmount = effectiveDiscount;
  booking.couponAmount = effectiveCouponAmount;
  booking.couponCode = effectiveCouponCode;
  await booking.save();

  // Sync Invoice Status: Mark official invoice as paid
  const invoiceRec = await Invoice.findOne({ bookingId: booking._id });
  if (invoiceRec) {
    invoiceRec.status = 'paid';
    invoiceRec.amount = booking.totalAmount;
    invoiceRec.totalAmount = booking.totalAmount;
    invoiceRec.taxAmount = booking.taxAmount || 0;
    invoiceRec.discountAmount = effectiveDiscount;
    invoiceRec.couponAmount = effectiveCouponAmount;
    invoiceRec.couponCode = effectiveCouponCode;

    const existingItems = Array.isArray(invoiceRec.items) ? [...invoiceRec.items] : [];
    const cleanedItems = existingItems.filter((item) => {
      const desc = (item.description || '').toLowerCase();
      const isNeg = (item.unitPrice || 0) < 0 || (item.total || 0) < 0;
      const isDiscountOrCoupon = /discount|coupon|voucher/.test(desc);
      return !(isNeg && isDiscountOrCoupon);
    });

    if (effectiveDiscount > 0) {
      cleanedItems.push({
        description: 'Promotion Discount',
        quantity: 1,
        unitPrice: -effectiveDiscount,
        total: -effectiveDiscount
      });
    }

    if (effectiveCouponAmount > 0) {
      cleanedItems.push({
        description: effectiveCouponCode ? `Cash Voucher Applied (${effectiveCouponCode})` : 'Cash Voucher Applied',
        quantity: 1,
        unitPrice: -effectiveCouponAmount,
        total: -effectiveCouponAmount
      });
    }

    invoiceRec.items = cleanedItems;
    await invoiceRec.save();
  }

  // Notify User
  const userData = await User.findById(created.userId);
  if (userData) {
    sendPaymentConfirmationEmail(created, userData, `your booking for ${classItem.title}`).catch(err => console.error('Booking payment email failed:', err.message));
  }

  res.status(201).json(created);
});

export const exportPaymentsCsv = asyncHandler(async (req, res) => {
  const locationIds = resolveReadLocationIds(req);
  const filter = locationIds ? { locationId: { $in: locationIds } } : {};
  const payments = await Payment.find(filter)
    .populate('userId', 'name email')
    .populate({
      path: 'bookingId',
      populate: { path: 'classId', select: 'title' }
    })
    .populate('planId', 'name price')
    .sort({ createdAt: -1 });

  const rows = payments.map((p) => ({
    user: p.userId?.name,
    email: p.userId?.email,
    amount: p.amount,
    status: p.status,
    plan: p.planId?.name,
    last4: p.last4,
    reference: p.reference,
    createdAt: p.createdAt
  }));

  const csv = toCsv(rows, [
    { key: 'user', label: 'User' },
    { key: 'email', label: 'Email' },
    { key: 'amount', label: 'Amount' },
    { key: 'status', label: 'Status' },
    { key: 'plan', label: 'Plan' },
    { key: 'last4', label: 'Card Last4' },
    { key: 'reference', label: 'Reference' },
    { key: 'createdAt', label: 'Created At' }
  ]);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
  res.send(csv);
});
