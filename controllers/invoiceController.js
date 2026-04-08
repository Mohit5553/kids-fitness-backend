import asyncHandler from 'express-async-handler';
import Invoice from '../models/Invoice.js';
import Booking from '../models/Booking.js';
import { getNextInvoiceNumber } from '../utils/sequenceGenerator.js';

/**
 * Helper to generate a missing invoice for a booking
 */
const generateInvoiceFromBooking = async (booking) => {
  const invoiceNumber = await getNextInvoiceNumber();

  await booking.populate('classId', 'title price');

  const invoiceData = {
    invoiceNumber,
    bookingId: booking._id,
    userId: booking.userId,
    guestDetails: booking.guestDetails,
    amount: booking.totalAmount,
    status: ['confirmed', 'attended', 'completed'].includes(booking.status) ? 'paid' : 'unpaid',
    locationId: booking.locationId,
    date: booking.createdAt,
    items: [
      {
        description: `${booking.classId?.title || 'Fitness Session'} - Booking`,
        quantity: booking.participants?.length || 1,
        unitPrice: booking.classId?.price || (booking.totalAmount / (booking.participants?.length || 1)),
        total: booking.totalAmount
      }
    ]
  };

  return await Invoice.create(invoiceData);
};

// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private/Admin
export const getInvoices = asyncHandler(async (req, res) => {
  const invoices = await Invoice.find({})
    .populate('bookingId', 'bookingNumber date status')
    .populate('userId', 'name email')
    .sort({ createdAt: -1 });
  res.json(invoices);
});

// @desc    Get my invoices
// @route   GET /api/invoices/mine
// @access  Private
export const getMyInvoices = asyncHandler(async (req, res) => {
  const invoices = await Invoice.find({ userId: req.user._id })
    .populate('bookingId', 'bookingNumber date status')
    .sort({ createdAt: -1 });
  res.json(invoices);
});

// @desc    Get invoice by ID
// @route   GET /api/invoices/:id
// @access  Private
export const getInvoiceById = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id)
    .populate('bookingId', 'bookingNumber date status classId sessionId')
    .populate('userId', 'name email address phone city country')
    .populate('locationId', 'name address phone email');

  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }

  // Check ownership
  const userRole = (req.user.role || '').toLowerCase();
  // Universal Staff Check: Anyone with permissions or not a basic parent/customer
  const isStaff = (req.user.permissions && req.user.permissions.length > 0) ||
    !['parent', 'customer'].includes(userRole);

  // Handle both raw ID and populated user object
  const invoiceUserId = invoice.userId?._id?.toString() || invoice.userId?.toString();
  const isOwner = invoiceUserId === req.user._id.toString();

  // Double-Check: Match by email from the populated user object
  const isUserEmailMatch = req.user.email && invoice.userId?.email?.toLowerCase() === req.user.email.toLowerCase();
  const isGuestOwner = req.user.email && invoice.guestDetails?.email?.toLowerCase() === req.user.email.toLowerCase();

  if (!isStaff && !isOwner && !isUserEmailMatch && !isGuestOwner) {
    console.log(`[ACCESS DENIED] User: ${req.user._id} (${userRole}) attempted to view invoice: ${invoice._id}`);
    console.log(`[DEBUG] isStaff: ${isStaff}, isOwner: ${isOwner}, isUserEmailMatch: ${isUserEmailMatch}, isGuestOwner: ${isGuestOwner}`);
    res.status(403);
    throw new Error('Not authorized');
  }

  // HEALING LOGIC: Sync invoice status with booking status (handles historical mismatches)
  if (invoice.bookingId && ['cancelled', 'refunded'].includes(invoice.bookingId.status) && invoice.status === 'paid') {
    invoice.status = 'cancelled';
    await invoice.save();
  }

  res.json(invoice);
});

// @desc    Get invoice by Booking ID
// @route   GET /api/invoices/booking/:bookingId
// @access  Private
export const getInvoiceByBookingId = asyncHandler(async (req, res) => {
  let invoice = await Invoice.findOne({ bookingId: req.params.bookingId })
    .populate('bookingId', 'bookingNumber date status classId sessionId')
    .populate('userId', 'name email address phone city country')
    .populate('locationId', 'name address phone email');

  // HEALING LOGIC: Generate invoice if it doesn't exist
  if (!invoice) {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) {
      res.status(404);
      throw new Error('Booking not found');
    }

    invoice = await generateInvoiceFromBooking(booking);
    // Re-populate to match expected format
    await invoice.populate([
      { path: 'bookingId', select: 'bookingNumber date status classId sessionId' },
      { path: 'userId', select: 'name email address phone city country' },
      { path: 'locationId', select: 'name address phone email' }
    ]);
  }

  // Check ownership
  const userRole = (req.user.role || '').toLowerCase();
  // Universal Staff Check: Anyone with permissions or not a basic parent/customer
  const isStaff = (req.user.permissions && req.user.permissions.length > 0) ||
    !['parent', 'customer'].includes(userRole);

  // Handle both raw ID and populated user object
  const invoiceUserId = invoice.userId?._id?.toString() || invoice.userId?.toString();
  const isOwner = invoiceUserId === req.user._id.toString();

  // Double-Check: Match by email from the populated user object
  const isUserEmailMatch = req.user.email && invoice.userId?.email?.toLowerCase() === req.user.email.toLowerCase();
  const isGuestOwner = req.user.email && invoice.guestDetails?.email?.toLowerCase() === req.user.email.toLowerCase();

  if (!isStaff && !isOwner && !isUserEmailMatch && !isGuestOwner) {
    console.log(`[ACCESS DENIED] User: ${req.user._id} (${userRole}) attempted to view invoice for booking: ${req.params.bookingId}`);
    console.log(`[DEBUG] isStaff: ${isStaff}, isOwner: ${isOwner}, isUserEmailMatch: ${isUserEmailMatch}, isGuestOwner: ${isGuestOwner}`);
    res.status(403);
    throw new Error('Not authorized');
  }

  // HEALING LOGIC: Sync invoice status with booking status (handles historical mismatches)
  if (invoice.bookingId && ['cancelled', 'refunded'].includes(invoice.bookingId.status) && invoice.status === 'paid') {
    invoice.status = 'cancelled';
    await invoice.save();
  }

  res.json(invoice);
});

// @desc    Update invoice status
// @route   PUT /api/invoices/:id
// @access  Private/Admin
export const updateInvoiceStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const invoice = await Invoice.findById(req.params.id);

  if (invoice) {
    invoice.status = status || invoice.status;
    const updated = await invoice.save();
    res.json(updated);
  } else {
    res.status(404);
    throw new Error('Invoice not found');
  }
});
