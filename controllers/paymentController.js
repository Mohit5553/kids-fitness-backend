import asyncHandler from 'express-async-handler';
import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import ClassModel from '../models/Class.js';
import Plan from '../models/Plan.js';
import Membership from '../models/Membership.js';
import User from '../models/User.js';
import { toCsv } from '../utils/csv.js';
import { resolveReadLocationIds } from '../utils/locationScope.js';
import { sendPaymentConfirmationEmail } from '../utils/mailer.js';
import { linkUserBookings } from './bookingController.js';

// Internal function to heal missing Payment records for any confirmed bookings
const syncPayments = async (user = null) => {
  try {
    // 1. If user provided, run their guest linkage/healing first
    if (user) {
      await linkUserBookings(user);
    }

    // 2. Global Healing: Find ANY confirmed booking since March 24 missing a Payment record
    // Using March 1st as a safe "recent" margin
    const startDate = new Date('2026-03-01'); 
    const missingBookings = await Booking.find({
      paymentStatus: 'completed',
      createdAt: { $gte: startDate }
    });

    for (const b of missingBookings) {
      const exists = await Payment.findOne({ bookingId: b._id });
      if (!exists) {
        await Payment.create({
          userId: b.userId,
          bookingId: b._id,
          amount: b.totalAmount,
          paymentMethod: b.paymentMethod || 'online',
          status: 'paid',
          locationId: b.locationId,
          createdAt: b.createdAt
        });
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
      select: 'status date classId guestDetails',
      populate: { path: 'classId', select: 'title' }
    })
    .populate('planId', 'name price')
    .populate({
      path: 'membershipId',
      populate: { path: 'planId', select: 'name' }
    })
    .sort({ createdAt: -1 });
  res.json(payments);
});

export const getAllPayments = asyncHandler(async (req, res) => {
  // Run global sync/healing for admin view
  await syncPayments();

  const locationIds = resolveReadLocationIds(req);
  const filter = locationIds ? { locationId: { $in: locationIds } } : {};
  const payments = await Payment.find(filter)
    .populate('userId', 'name email')
    .populate({
      path: 'bookingId',
      select: 'status date classId guestDetails',
      populate: { path: 'classId', select: 'title' }
    })
    .populate('planId', 'name price')
    .populate({
      path: 'membershipId',
      populate: { path: 'planId', select: 'name' }
    })
    .sort({ createdAt: -1 });
  res.json(payments);
});

export const createPayment = asyncHandler(async (req, res) => {
  const { bookingId, planId, membershipId, amount, paymentMethod, reference, last4 } = req.body;
  if (!amount) {
    res.status(400);
    throw new Error('Amount is required');
  }

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
    userId: req.user._id,
    bookingId,
    planId,
    membershipId,
    amount,
    paymentMethod,
    status: 'paid',
    reference,
    last4,
    locationId
  });

  // Notify User
  const userData = await User.findById(created.userId);
  if (userData) {
    sendPaymentConfirmationEmail(created, userData).catch(err => console.error('Payment confirmation email failed:', err.message));
  }

  res.status(201).json(created);
});

export const createBookingPayment = asyncHandler(async (req, res) => {
  const { bookingId, paymentMethod, reference, last4 } = req.body;
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

  const created = await Payment.create({
    userId: req.user._id,
    bookingId,
    amount: classItem.price,
    paymentMethod: paymentMethod || 'card',
    status: 'paid',
    reference,
    last4,
    locationId: booking.locationId
  });

  booking.status = 'confirmed';
  booking.paymentStatus = 'completed';
  booking.paymentReference = reference;
  booking.paymentId = created._id;
  booking.paymentDate = new Date();
  booking.paymentDate = new Date();
  await booking.save();

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
