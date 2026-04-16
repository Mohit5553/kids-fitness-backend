import asyncHandler from 'express-async-handler';
import Invoice from '../models/Invoice.js';
import Booking from '../models/Booking.js';
import { getNextInvoiceNumber } from '../utils/sequenceGenerator.js';

/**
 * Helper to heal inconsistent invoice data for older records
 */
const healInvoiceData = (invoice) => {
  if (!invoice || !invoice.items || invoice.items.length === 0) return invoice;

  let hasChanges = false;

  // 1. Detect and Refactor BOGO Items to Standard (QTY 2 + Negative Discount)
  const bogoItemIndex = invoice.items.findIndex(item => 
    (item.description?.toUpperCase().includes('BOGO') || item.description?.toUpperCase().includes('DOUBLE ACCESS')) && 
    item.quantity === 1 && (item.unitPrice === 0 || item.total === 0)
  );

  if (bogoItemIndex !== -1) {
    const mainEnrollmentItem = invoice.items.find(item => item.description?.toUpperCase().includes('ENROLLMENT'));
    if (mainEnrollmentItem && mainEnrollmentItem.quantity === 1) {
      const originalPrice = mainEnrollmentItem.unitPrice;
      
      // Update main item to QTY 2
      mainEnrollmentItem.quantity = 2;
      mainEnrollmentItem.total = originalPrice * 2;
      
      // Update BOGO line to negative discount
      const bogoItem = invoice.items[bogoItemIndex];
      bogoItem.unitPrice = -originalPrice;
      bogoItem.total = -originalPrice;
      bogoItem.description = 'BOGO Promotion - Free Item Saved';
      
      hasChanges = true;
      console.log(`[BOGO HEALER] Refactored invoice ${invoice.invoiceNumber} to QTY 2 layout`);
    }
  }

  // 2. Original Healing Logic: Tax Extraction & Totals
  invoice.items.forEach(item => {
    const expectedItemTotal = (item.unitPrice || 0) * (item.quantity || 1);
    if (Math.abs(item.total - expectedItemTotal) > 0.01 && item.total > expectedItemTotal) {
      item.taxAmount = item.total - expectedItemTotal;
      item.total = expectedItemTotal;
      hasChanges = true;
    }
  });

  const actualTaxSum = invoice.items.reduce((sum, i) => sum + (i.taxAmount || 0), 0);
  if (invoice.taxAmount === 0 && actualTaxSum > 0) {
    invoice.taxAmount = actualTaxSum;
    hasChanges = true;
  }

  if (hasChanges) {
    invoice.markModified('items');
    invoice.markModified('taxAmount');
  }

  return { invoice, hasChanges };
};

/**
 * Helper to generate a missing invoice for a booking
 */
const generateInvoiceFromBooking = async (booking) => {
  const invoiceNumber = await getNextInvoiceNumber();

  await booking.populate('classId', 'title price');
  await booking.populate('promotionId', 'promoType name');

  const isBogo = booking.promotionId?.promoType === 'bogo' || 
                 (booking.participants?.length === 2 && booking.discountAmount > 0);

  const baseQty = isBogo ? 2 : (booking.participants?.length || 1);
  const basePrice = (booking.totalAmount + (booking.discountAmount || 0) + (booking.couponAmount || 0));
  const baseRate = (basePrice - (booking.taxAmount || 0)) / (isBogo ? 2 : baseQty);

  // Gross amount = sum of positive line items (before any discounts/coupons/tax)
  const grossAmount = baseRate * baseQty;
  // Total amount = final net amount paid (including tax)
  const totalAmount = booking.totalAmount;

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
        description: `${booking.classId?.title || 'Fitness Session'} - Package Enrollment`,
        quantity: baseQty,
        unitPrice: baseRate,
        total: baseRate * baseQty
      }
    ],
    taxAmount: booking.taxAmount || 0,
    grossAmount,
    totalAmount,
    discountAmount: booking.discountAmount || 0,
    couponAmount: booking.couponAmount || 0,
    couponCode: booking.couponCode
  };

  if (isBogo) {
    invoiceData.items.push({
      description: `BOGO Promotion - ${booking.promotionId?.name || 'Free Item'}`,
      quantity: 1,
      unitPrice: -baseRate,
      total: -baseRate
    });
  } else if (booking.discountAmount > 0) {
    invoiceData.items.push({
      description: 'Promotion Discount (Fixed)',
      quantity: 1,
      unitPrice: -booking.discountAmount,
      total: -booking.discountAmount
    });
  }

  if (booking.couponAmount > 0) {
    invoiceData.items.push({
      description: `Cash Voucher Applied: ${booking.couponCode}`,
      quantity: 1,
      unitPrice: -booking.couponAmount,
      total: -booking.couponAmount
    });
  }

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
    .populate('userId', 'name email address phone city country companyName tradeLicenseNo taxNumber companyAddress')
    .populate('locationId', 'name address phone email');

  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }

  // Check ownership
  const userRole = (req.user.role || '').toLowerCase();
  const isStaff = (req.user.permissions?.length > 0) ||
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
  } else {
    // HEAL inconsistent data itemization
    const { hasChanges } = healInvoiceData(invoice);
    if (hasChanges) await invoice.save();
  }

  res.json(invoice);
});

// @desc    Get invoice by Booking ID
// @route   GET /api/invoices/booking/:bookingId
// @access  Private
export const getInvoiceByBookingId = asyncHandler(async (req, res) => {
  let invoice = await Invoice.findOne({ bookingId: req.params.bookingId })
    .populate('bookingId', 'bookingNumber date status classId sessionId')
    .populate('userId', 'name email address phone city country companyName tradeLicenseNo taxNumber companyAddress')
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
      { path: 'userId', select: 'name email address phone city country companyName tradeLicenseNo taxNumber companyAddress' },
      { path: 'locationId', select: 'name address phone email' }
    ]);
  } else {
    // HEAL existing invoice if data is inconsistent
    const { hasChanges } = healInvoiceData(invoice);
    if (hasChanges) {
      await invoice.save(); // Persist the fix
    }
  }

  // Check ownership — use normalized role to handle 'store cashier', 'store-cashier', etc.
  const userRole = (req.user.role || '').toLowerCase();
  const normalizedRole = userRole.replace(/[\s_-]/g, '');
  const isStaff = ['admin', 'manager', 'cashier'].some(r => normalizedRole.includes(r)) ||
    normalizedRole === 'superadmin' ||
    (req.user.permissions?.length > 0);

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
