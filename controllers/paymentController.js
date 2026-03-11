import asyncHandler from 'express-async-handler';
import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import ClassModel from '../models/Class.js';
import Plan from '../models/Plan.js';
import Membership from '../models/Membership.js';
import { toCsv } from '../utils/csv.js';
import { resolveReadLocationId } from '../utils/locationScope.js';

export const getMyPayments = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ userId: req.user._id })
    .populate('bookingId', 'status date')
    .populate('planId', 'name price')
    .populate('membershipId', 'status')
    .sort({ createdAt: -1 });
  res.json(payments);
});

export const getAllPayments = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const payments = await Payment.find(filter)
    .populate('userId', 'name email')
    .populate('bookingId', 'status date')
    .populate('planId', 'name price')
    .populate('membershipId', 'status')
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
  await booking.save();

  res.status(201).json(created);
});

export const exportPaymentsCsv = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const payments = await Payment.find(filter)
    .populate('userId', 'name email')
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
