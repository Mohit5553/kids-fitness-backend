import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import Session from '../models/Session.js';
import ClassModel from '../models/Class.js';
import SalesOrder from '../models/SalesOrder.js';
import Location from '../models/Location.js';
import { resolveReadLocationId } from '../utils/locationScope.js';
import { sendBookingConfirmationEmail, sendBookingUpdateEmail, sendSessionReminderEmail } from '../utils/mailer.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import Invoice from '../models/Invoice.js';
import Attendance from '../models/Attendance.js';
import { getNextInvoiceNumber } from '../utils/sequenceGenerator.js';
import Membership from '../models/Membership.js';
import Child from '../models/Child.js';
import Promotion from '../models/Promotion.js';
import Tax from '../models/Tax.js';
import { calculateTax } from '../utils/taxCalculator.js';
import Coupon from '../models/Coupon.js';

export const getMyBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({
    $or: [
      { userId: req.user._id },
      { 'guestDetails.email': req.user.email }
    ]
  })
    .populate('classId', 'title price')
    .populate('planId', 'name price priceMonthly')
    .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
    .sort({ createdAt: -1 });
  res.json(bookings);
});

export const getAllBookings = asyncHandler(async (req, res) => {
  const { sessionId, trainerId, userId, childId } = req.query;
  
  // Visibility Logic: If we're searching for a specific session or trainer, we skip the location filter 
  // so admins and trainers can see their work across all branches.
  const isDirectLookup = sessionId || trainerId || userId || childId;
  const filter = {};
  
  if (userId) filter.userId = userId;
  if (childId) filter['participants.childId'] = childId;

  if (!isDirectLookup) {
    const locationId = resolveReadLocationId(req);
    if (locationId && locationId !== 'all') {
      filter.$or = [{ locationId }, { locationId: null }];
    }
  }

  if (sessionId) {
    filter.sessionId = sessionId;
  } else if (trainerId) {
    const trainerSessions = await Session.find({ trainerId }).select('_id');
    const trainerSessionIds = trainerSessions.map(s => s._id);
    filter.sessionId = { $in: trainerSessionIds };
  }
  const bookings = await Booking.find(filter)
    .populate('userId', 'name email')
    .populate('processedBy', 'name email')
    .populate('classId', 'title price')
    .populate('planId', 'name price validity')
    .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
    .populate('participants.childId', 'name age gender')
    .sort({ createdAt: -1 });

  // Filter by corporate name and group ID if provided in query
  const { corporateName, groupId } = req.query;
  let filtered = [...bookings];
  if (corporateName) {
    filtered = filtered.filter(b => b.corporateName?.toLowerCase().includes(corporateName.toLowerCase()));
  }
  if (groupId) {
    filtered = filtered.filter(b => b.groupId === groupId);
  }

  // If sessionId is provided, we also add all memberships that share this session to the roster
  if (sessionId) {
      const targetSession = await Session.findById(sessionId);
      if (targetSession) {
          // Find all memberships that contain this sessionId in their generated schedule
          const relevantMemberships = await Membership.find({ 
              generatedSessions: sessionId,
              status: 'active'
          })
          .populate('userId', 'name email phone')
          .populate('childId')
          .populate('planId', 'name');

          // Pre-fetch all attendance for this session to mark virtual bookings as attended
          const attendances = await Attendance.find({ sessionId });
          const attendedMemberIds = attendances.map(a => a.membershipId?.toString()).filter(Boolean);

          relevantMemberships.forEach(membership => {
              // Avoid duplicates if a membership somehow already has a real booking (rare)
              const alreadyExists = filtered.some(b => 
                (b.membershipId && b.membershipId.toString() === membership._id.toString()) ||
                (b._id === `MR-${membership._id}-${sessionId}`)
              );

              if (!alreadyExists) {
                  const isAttended = attendedMemberIds.includes(membership._id.toString());
                  
                  const virtualBooking = {
                      _id: `MR-${membership._id}-${sessionId}`,
                      bookingNumber: `MBR-${membership._id.toString().slice(-6).toUpperCase()}`,
                      bookingType: 'package',
                      userId: membership.userId,
                      participants: membership.childId ? [{
                          name: membership.childId.name,
                          age: membership.childId.age,
                          gender: membership.childId.gender,
                          relation: 'Child',
                          childId: membership.childId._id
                      }] : [{
                          name: membership.userId?.name || 'Account Holder',
                          age: 18,
                          relation: 'Self'
                      }],
                      status: isAttended ? 'attended' : 'confirmed',
                      paymentStatus: 'completed',
                      createdAt: membership.createdAt,
                      locationId: membership.locationId,
                      membershipId: membership._id,
                      planId: membership.planId,
                      isVirtualMembership: true
                  };
                  filtered.unshift(virtualBooking);
              }
          });
      }
  }

  res.json(filtered);
});

export const createBooking = asyncHandler(async (req, res) => {
  const { participants, classId, date, sessionId, paymentMethod, paymentStatus, guestDetails, userId, promotionId } = req.body;

  if (!req.user && (!guestDetails || !guestDetails.name || !guestDetails.email)) {
    res.status(400);
    throw new Error('Must be logged in or provide guest details');
  }

  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    res.status(400);
    throw new Error('Participants array is required');
  }

  if (!classId && !sessionId) {
    res.status(400);
    throw new Error('classId or sessionId is required');
  }

  let resolvedClassId = classId;
  let resolvedDate = date;
  let resolvedSessionId = sessionId;
  let resolvedLocationId = null;
  let session = null;

  if (sessionId) {
    session = await Session.findById(sessionId);
    if (!session) {
      res.status(404);
      throw new Error('Session not found');
    }
    resolvedClassId = session.classId;
    resolvedDate = session.startTime;
    resolvedLocationId = session.locationId;

    // Capacity Check (Bypass for admins/staff)
    const bookingUserRole = (req.user?.role || '').toLowerCase().replace(/[\s_-]/g, '');
    const isStaffBooking = ['admin', 'manager', 'cashier'].some(r => bookingUserRole.includes(r));
    
    // LIVE COUNT Check: Don't trust the session.bookedParticipants field
    const liveBookedCount = await mongoose.model('Booking').countDocuments({
      sessionId: session._id,
      status: { $ne: 'cancelled' }
    });
    
    const remainingCapacity = session.capacity - liveBookedCount;
    if (participants.length > remainingCapacity && !isStaffBooking) {
      res.status(400);
      const msg = remainingCapacity <= 0 
        ? 'This session is full' 
        : `Only ${remainingCapacity} spot${remainingCapacity > 1 ? 's' : ''} remaining in this session`;
      throw new Error(msg);
    }
  }

  const classItem = await ClassModel.findById(resolvedClassId);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }

  if (!resolvedLocationId) resolvedLocationId = classItem.locationId;
  if (!resolvedDate) {
    res.status(400);
    throw new Error('Date is required');
  }

  // Calculate Total Amount
  const discountAmount = Number(req.body.discountAmount) || 0;
  const couponAmount = Number(req.body.couponAmount) || 0;
  const rawBaseAmount = (classItem.price || 0) * participants.length;
  
  // Tax is calculated after all price-reducing discounts
  const netBaseAmount = Math.max(0, rawBaseAmount - discountAmount - couponAmount);
  
  let taxAmount = 0;
  let activeTax = null;

  if (classItem.taxId) {
    activeTax = await Tax.findById(classItem.taxId);
  } else if (resolvedLocationId) {
    activeTax = await Tax.findOne({ 
      locationId: resolvedLocationId, 
      status: 'active',
      $or: [
        { validityEnd: { $exists: false } },
        { validityEnd: { $gte: new Date() } }
      ]
    });
  }

  if (activeTax) {
    // calculateTax uses the provided numeric price as base
    taxAmount = calculateTax(netBaseAmount, activeTax);
  }
  
  // Final total paid by customer
  const totalAmount = activeTax?.calculationMethod === 'inclusive' 
    ? netBaseAmount 
    : netBaseAmount + taxAmount;

  // Age and Gender Validation
  for (const p of participants) {
    if (!p.name || !p.age || !p.gender) {
      res.status(400);
      throw new Error(`Please provide complete details for all participants`);
    }

    const pAge = Number(p.age);
    if (classItem.minAge !== undefined && classItem.minAge !== null && pAge < classItem.minAge) {
      res.status(400);
      throw new Error(`${p.name} is too young for this class. Minimum age: ${classItem.minAge}`);
    }
    if (classItem.maxAge !== undefined && classItem.maxAge !== null && pAge > classItem.maxAge) {
      res.status(400);
      throw new Error(`${p.name} is too old for this class. Maximum age: ${classItem.maxAge}`);
    }
    if (classItem.genderRestriction && classItem.genderRestriction !== 'any') {
      if (p.gender.toLowerCase() !== classItem.genderRestriction.toLowerCase()) {
        res.status(400);
        throw new Error(`${p.name}'s gender does not match the class restriction: ${classItem.genderRestriction}`);
      }
    }
  }

  // Generate Booking Number (BK-YYMMDD-XXXX)
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const randomStr = Math.random().toString(36).substring(2, 12).toUpperCase(); // 10 characters
  const bookingNumber = `BK-${dateStr}-${randomStr}`;

  const bookingData = {
    bookingNumber,
    participants,
    classId: resolvedClassId,
    sessionId: resolvedSessionId,
    date: resolvedDate,
    totalAmount,
    taxAmount,
    taxId: activeTax?._id || classItem.taxId,
    locationId: resolvedLocationId,
    paymentMethod,
    paymentStatus,
    paymentDate: paymentStatus === 'completed' ? new Date() : undefined,
    status: paymentStatus === 'completed' ? 'confirmed' : 'pending',
    promotionId,
    promotionId,
    discountAmount: discountAmount || 0,
    couponCode: req.body.couponCode,
    couponAmount: req.body.couponAmount || 0
  };

  if (req.user) {
    // Determine if the requester is staff (anyone NOT a simple parent or customer)
    const userRoleLower = (req.user.role || '').toLowerCase().trim();
    // Broad staff check: matches admins, superadmins, and any store manager/cashier roles regardless of hyphen/space
    const isStaff = !['parent', 'customer'].includes(userRoleLower) ||
      (req.user.permissions && req.user.permissions.length > 0);

    // If staff is booking for a walking customer/parent, use the provided userId
    bookingData.userId = (isStaff && userId) ? userId : req.user._id;

    if (isStaff) {
      bookingData.processedBy = req.user._id;
      bookingData.processedByRole = req.user.role;

      // Automated Confirmation for Center Cash payments by Staff
      if (paymentMethod === 'center_cash') {
        bookingData.paymentStatus = 'completed';
        bookingData.status = 'confirmed';
        bookingData.paymentDate = new Date();
      }
    }
  } else {
    bookingData.guestDetails = guestDetails;
  }

  const created = await Booking.create(bookingData);

  // OFFICIAL INVOICE GENERATION
  const invoiceNumber = await getNextInvoiceNumber();

  const invoiceItems = [
    {
      description: `${classItem.title} - Session Booking`,
      quantity: participants.length,
      unitPrice: classItem.price || 0,
      total: totalAmount
    }
  ];

  if (req.body.claimBogo) {
    invoiceItems.push({
      description: `BOGO Free Item - ${classItem.title}`,
      quantity: participants.length,
      unitPrice: 0,
      total: 0
    });
  }

  const invoiceData = {
    invoiceNumber,
    bookingId: created._id,
    userId: created.userId,
    guestDetails: created.guestDetails,
    amount: totalAmount,
    status: created.status === 'confirmed' ? 'paid' : 'unpaid',
    locationId: resolvedLocationId,
    items: invoiceItems,
    taxAmount: taxAmount,
    discountAmount: discountAmount || 0,
    couponAmount: req.body.couponAmount || 0,
    couponCode: req.body.couponCode
  };

  if (discountAmount > 0) {
    invoiceData.items.push({
      description: 'Promotion Discount',
      quantity: 1,
      unitPrice: -discountAmount,
      total: -discountAmount
    });
  }

  if (req.body.couponAmount > 0) {
    invoiceData.items.push({
      description: `Cash Voucher Applied (${req.body.couponCode})`,
      quantity: 1,
      unitPrice: -req.body.couponAmount,
      total: -req.body.couponAmount
    });
  }

  await Invoice.create(invoiceData);

  // If paying at center, generate a SalesOrder
  if (paymentMethod === 'center') {
    const orderData = {
      bookingId: created._id,
      amount: totalAmount,
      status: 'pending',
      locationId: resolvedLocationId
    };
    if (created.userId) {
      orderData.userId = created.userId;
    } else {
      orderData.guestDetails = guestDetails;
    }
    await SalesOrder.create(orderData);
  }

  // Create a Payment record for both online and center payments so it shows in the Payments list
  const paymentRec = await Payment.create({
    userId: created.userId,
    bookingId: created._id,
    amount: totalAmount,
    discountAmount: discountAmount || 0,
    promotionId: promotionId,
    paymentMethod: paymentMethod || 'center',
    status: paymentMethod === 'online' ? 'paid' : 'pending',
    locationId: resolvedLocationId,
    processedBy: req.user?._id
  });

  const paymentId = paymentRec._id;

  // Update session occupancy if applicable
  if (session) {
    session.bookedParticipants += participants.length;
    await session.save();
  }

  // Send Confirmation Email
  const userForEmail = req.user || { name: guestDetails.name, email: guestDetails.email };
  sendBookingConfirmationEmail(created, classItem, userForEmail).catch(err => console.error('Booking confirmation email failed:', err.message));

  // Real-time Notification for Admins
  const io = req.app.get('io');
  if (io) {
    const loc = await Location.findById(resolvedLocationId).select('name');
    io.to('admin_room').emit('new_booking', {
      bookingNumber: created.bookingNumber,
      locationName: loc?.name || 'Unknown Location',
      locationId: resolvedLocationId,
      amount: totalAmount,
      customerName: userForEmail.name
    });
  }


  // COUPON GENERATION LOGIC (Cash Deposit Promo)
  if (promotionId) {
    const promo = await Promotion.findById(promotionId);
    if (promo && promo.promoType === 'cash_deposit') {
      const couponValue = (promo.discountType === 'percentage') 
        ? (totalAmount * (promo.discountValue / 100))
        : Math.min(totalAmount, promo.discountValue);
      
      if (couponValue > 0) {
        const couponCode = `CPN-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 90); // 90 days validity

        await Coupon.create({
          code: couponCode,
          userId: created.userId,
          amount: Math.round(couponValue * 100) / 100,
          expiryDate,
          sourceBookingId: created._id,
          status: 'active'
        });
      }
    }
  }

  // COUPON REDEMPTION LOGIC (Applying a coupon)
  if (req.body.couponCode) {
    const redeemedCoupon = await Coupon.findOne({ 
      code: req.body.couponCode.toUpperCase(), 
      status: 'active' 
    });
    if (redeemedCoupon) {
      redeemedCoupon.status = 'redeemed';
      redeemedCoupon.redeemBookingId = created._id;
      redeemedCoupon.redeemedAt = new Date();
      // Assign user if it was an anonymous voucher
      if (!redeemedCoupon.userId) {
        redeemedCoupon.userId = created.userId;
      }
      await redeemedCoupon.save();
    }
  }

  res.status(201).json(created);
});



export const updateBookingStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, paymentMethod, reference } = req.body;

  // 1. Handle Virtual Membership Attendance (MR-prefix)
  if (id.startsWith('MR-')) {
    const parts = id.split('-');
    // Expected format: MR-membershipId-sessionId
    if (parts.length < 3) {
      res.status(400);
      throw new Error('Invalid virtual booking ID format');
    }
    const membershipId = parts[1];
    const sessionId = parts[2];

    if (!mongoose.Types.ObjectId.isValid(membershipId) || !mongoose.Types.ObjectId.isValid(sessionId)) {
      res.status(400);
      throw new Error('Invalid IDs in virtual booking');
    }

    if (status !== 'attended') {
      res.status(400);
      throw new Error('Only attendance can be updated for membership rosters currently');
    }

    const membership = await Membership.findById(membershipId).populate('userId childId');
    if (!membership) {
      res.status(404);
      throw new Error('Membership not found');
    }

    // Create/Update Attendance Record
    const filter = {
      sessionId,
      membershipId: membership._id
    };

    if (membership.childId) {
      filter.childId = membership.childId._id;
    } else {
      filter.userId = membership.userId?._id;
    }

    // Check if attendance already exists to prevent double-deduction from classesRemaining
    const existingAttendance = await Attendance.findOne(filter);
    
    if (!existingAttendance && status === 'attended') {
      if (membership.classesRemaining > 0) {
        membership.classesRemaining -= 1;
        await membership.save();
      }
    }

    await Attendance.findOneAndUpdate(
      filter,
      {
        ...filter,
        participantName: membership.childId?.name || membership.userId?.name,
        locationId: membership.locationId,
        status: 'present',
        method: 'manual',
        checkedInAt: new Date()
      },
      { upsert: true, new: true }
    );

    return res.json({ 
      message: 'Membership attendance recorded successfully',
      classesRemaining: membership.classesRemaining 
    });
  }

  // 2. Standard Booking Logic
  const booking = await Booking.findById(id);
  if (req.user?.role === 'admin' && req.user.locationId && booking.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }

  const oldStatus = booking.status;
  
  // Sequential Workflow Validation
  if (status === 'attended' && booking.status !== 'confirmed') {
    res.status(400);
    throw new Error('Trainer cannot confirm attendance until payment is ' + booking.status);
  }
  if (status === 'completed' && booking.status !== 'attended') {
    res.status(400);
    throw new Error('Accounts cannot finalize until class attendance is verified');
  }

  // Handle capacity decrement on cancellation (Self-syncing via countDocuments)
  if (status === 'cancelled' && oldStatus !== 'cancelled' && booking.sessionId) {
    // No manual decrement needed; live queries handle this
  }
  // Handle capacity increment if re-activating
  if (oldStatus === 'cancelled' && status && status !== 'cancelled' && booking.sessionId) {
    const session = await Session.findById(booking.sessionId);
    if (session) {
      const liveCount = await mongoose.model('Booking').countDocuments({
        sessionId: session._id,
        status: { $ne: 'cancelled' }
      });
      const remaining = session.capacity - liveCount;
      if (booking.participants.length > remaining) {
        res.status(400);
        throw new Error('Cannot restore booking: session is now full');
      }
      // No manual increment needed
    }
  }

  // Update Lifecycle tracking
  const normalizedRole = (req.user.role || '').toLowerCase().replace(/[\s_-]/g, '');
  booking.status = status || booking.status;

  if (status === 'confirmed') {
    booking.paymentStatus = 'completed';
    booking.lifecycle = { 
      ...booking.lifecycle, 
      paidAt: new Date(), 
      paidBy: req.user?._id 
    };

    // Sync status and transaction specifics back to Payment record
    // Try to find payment by bookingId or groupId
    const payRec = await Payment.findOne({ 
      $or: [
        { bookingId: booking._id },
        { groupId: booking.groupId }
      ].filter(cond => cond.groupId !== undefined || cond.bookingId !== undefined)
    });
    
    if (payRec) {
      payRec.status = 'paid';
      const finalMethod = paymentMethod ? `center_${paymentMethod}` : 'center';
      payRec.paymentMethod = finalMethod;
      if (reference) payRec.reference = reference;
      await payRec.save();

      // Also update booking's specific payment details
      booking.paymentMethod = finalMethod;
      booking.paymentReference = reference;
    }

    // Sync Invoice Status: Ensure official invoice is marked as paid
    const invoiceRec = await Invoice.findOne({ bookingId: booking._id });
    if (invoiceRec) {
      invoiceRec.status = 'paid';
      await invoiceRec.save();
    }
  }

  if (status === 'cancelled') {
    // Sync Invoice Status: Ensure official invoice is marked as cancelled
    const invoiceRec = await Invoice.findOne({ bookingId: booking._id });
    if (invoiceRec) {
      invoiceRec.status = 'cancelled';
      await invoiceRec.save();
    }
  }

  if (status === 'attended') {
    booking.lifecycle = { 
      ...booking.lifecycle, 
      attendedAt: new Date(), 
      attendedBy: req.user?._id 
    };

    // Auto-create Attendance records for Admin clarity
    if (booking.sessionId) {
      for (const p of booking.participants) {
        try {
          const filter = { 
            sessionId: booking.sessionId, 
            bookingId: booking._id 
          };
          
          if (p.childId) {
            filter.childId = p.childId;
          } else {
            filter.participantName = p.name;
          }

          await Attendance.findOneAndUpdate(
            filter,
            {
              ...filter,
              userId: booking.userId,
              locationId: booking.locationId,
              status: 'present',
              method: 'manual',
              checkedInAt: new Date()
            },
            { upsert: true, new: true }
          );
        } catch (err) {
          console.error('[Attendance Sync] Failed to create record:', err.message);
        }
      }
    }
  }

  if (status === 'completed') {
    booking.lifecycle = { 
      ...booking.lifecycle, 
      finalizedAt: new Date(), 
      finalizedBy: req.user?._id 
    };
  }

  // Record who processed the latest confirmation
  const isStaff = ['admin', 'manager', 'cashier'].some(r => normalizedRole.includes(r)) ||
    normalizedRole === 'superadmin' ||
    (req.user && req.user.role !== 'parent' && req.user.role !== 'customer');
  if (isStaff) {
    booking.processedBy = req.user._id;
    booking.processedByRole = req.user.role;
  }

  const saved = await booking.save();

  // Send Status Update Email
  if (status) {
    const userData = await User.findById(saved.userId) || saved.guestDetails;
    if (userData && (userData.email || saved.guestDetails?.email)) {
      sendBookingUpdateEmail(saved, saved.status, userData).catch(err => console.error('Booking status update email failed:', err.message));
    }
  }

  res.json(saved);
});

export const requestRefund = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }

  if (booking.userId.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }

  const isPaid = booking.paymentStatus === 'completed' || booking.status === 'confirmed';
  if (!isPaid) {
    res.status(400);
    throw new Error('Only paid or confirmed bookings can be refunded');
  }

  const now = new Date();
  const sessionDate = new Date(booking.date);

  // Allow refund anytime BEFORE the session starts
  if (now >= sessionDate) {
    res.status(400);
    throw new Error('Refunds can only be requested before the session starts');
  }

  booking.refundStatus = 'requested';
  await booking.save();

  res.json({ message: 'Refund request submitted successfully' });
});

export const resolveRefundRequest = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }

  if (status === 'refunded') {
    booking.refundStatus = 'refunded';
    booking.status = 'cancelled';

    // FREE the session slot so others can book it (Self-syncing via countDocuments)
    if (booking.sessionId) {
      // Logic handled via live query in other endpoints
    }

    // Sync Invoice Status: Mark invoice as cancelled upon refund
    const invoiceRec = await Invoice.findOne({ bookingId: booking._id });
    if (invoiceRec) {
      invoiceRec.status = 'cancelled';
      await invoiceRec.save();
    }
  } else if (status === 'declined') {
    if (!reason) {
      res.status(400);
      throw new Error('Rejection reason is required');
    }
    booking.refundStatus = 'declined';
    booking.refundRejectionReason = reason;
  } else {
    res.status(400);
    throw new Error('Invalid status');
  }

  await booking.save();

  // Send Refund/Status Update Email
  const userData = await User.findById(booking.userId) || booking.guestDetails;
  if (userData) {
    const statusLabel = status === 'refunded' ? 'Cancelled & Refunded' : 'Refund Request Declined';
    sendBookingUpdateEmail(booking, statusLabel, userData).catch(err => console.error('Refund resolution email failed:', err.message));
  }

  res.json({ message: `Refund request ${status} successfully`, booking });
});

export const lookupGuestBooking = asyncHandler(async (req, res) => {
  const { email, bookingNumber } = req.query;

  if (!email || !bookingNumber) {
    res.status(400);
    throw new Error('Email and Booking Number are required');
  }

  const booking = await Booking.findOne({
    bookingNumber: bookingNumber.toUpperCase(),
    $or: [
      { 'guestDetails.email': new RegExp(`^${email}$`, 'i') },
      { userId: await User.findOne({ email: new RegExp(`^${email}$`, 'i') }).select('_id') }
    ]
  })
    .populate('classId', 'title description image')
    .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
    .populate('locationId', 'name address');

  if (!booking) {
    res.status(404);
    throw new Error('Booking not found with these details');
  }

  res.json(booking);
});

export const deleteBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }
  const isOwner = booking.userId && booking.userId.toString() === req.user._id.toString();
  const isAdmin = ['admin', 'superadmin', 'store-manager', 'store-cashier'].includes(req.user.role);

  if (!isOwner && !isAdmin) {
    res.status(403);
    throw new Error('Not allowed');
  }

  // Revert capacity if not already cancelled (Self-syncing via countDocuments)
  if (booking.status !== 'cancelled' && booking.sessionId) {
    // Logic handled via live query
  }

  await booking.deleteOne();
  res.json({ message: 'Booking removed' });
});

/**
 * Links any existing guest bookings/orders to a user account based on email.
 * This is called during registration and login.
 */
export const linkUserBookings = async (user) => {
  if (!user || !user.email) return;

  try {
    const emailRegex = new RegExp(`^${user.email}$`, 'i');

    // 1. Link Bookings
    const bookingResult = await Booking.updateMany(
      { userId: { $exists: false }, 'guestDetails.email': emailRegex },
      { $set: { userId: user._id } }
    );

    // 2. Link SalesOrders
    const orderResult = await SalesOrder.updateMany(
      { userId: { $exists: false }, 'guestDetails.email': emailRegex },
      { $set: { userId: user._id } }
    );

    // 3. Link Payments
    const linkedBookings = await Booking.find({ userId: user._id }).select('_id');
    const bookingIds = linkedBookings.map(b => b._id);
    const paymentResult = await Payment.updateMany(
      {
        userId: { $exists: false },
        $or: [
          { 'guestDetails.email': emailRegex },
          { bookingId: { $in: bookingIds } }
        ]
      },
      { $set: { userId: user._id } }
    );

    // 4. Heal Missing Payments
    // Find confirmed bookings for this user that are missing a Payment record
    const bookingsMissingPayments = await Booking.find({
      userId: user._id,
      paymentStatus: 'completed'
    });

    let healedCount = 0;
    for (const b of bookingsMissingPayments) {
      const exists = await Payment.findOne({ bookingId: b._id });
      if (!exists) {
        await Payment.create({
          userId: user._id,
          bookingId: b._id,
          amount: b.totalAmount,
          paymentMethod: b.paymentMethod || 'online',
          status: 'paid',
          locationId: b.locationId,
          createdAt: b.createdAt // Keep original date if possible
        });
        healedCount++;
      }
    }

    console.log(`Linked ${bookingResult.modifiedCount} bookings, ${orderResult.modifiedCount} orders, ${paymentResult.modifiedCount} payments, and healed ${healedCount} missing payments for ${user.email}`);
  } catch (error) {
    console.error(`Error linking guest bookings for ${user.email}:`, error);
  }
};

/**
 * Creates individual bookings for multiple participants across multiple sessions.
 * Consolidated into a single SalesOrder and Payment.
 */
export const createGroupBooking = asyncHandler(async (req, res) => {
  const { participants, sessionIds, sessions, classId: providedClassId, locationId: providedLocationId, corporateName: providedCorporateName, paymentMethod, promotionId, discountAmount, couponCode, couponAmount } = req.body;

  const resolvedSessionIds = sessionIds || sessions;

  if (!participants || !participants.length || !resolvedSessionIds || !resolvedSessionIds.length) {
    res.status(400);
    throw new Error('Please provide participants and sessionIds');
  }

  // Resolve Class and Location from first session if not provided
  let classId = providedClassId;
  let locationId = providedLocationId;

  if (!classId || !locationId) {
    const firstSession = await Session.findById(resolvedSessionIds[0]);
    if (!firstSession) {
      res.status(404);
      throw new Error('First session in group not found');
    }
    classId = classId || firstSession.classId;
    locationId = locationId || firstSession.locationId;
  }

  if (!classId || !locationId) {
    res.status(400);
    throw new Error('Could not resolve classId or locationId for the group');
  }

  // 1. Resolve Corporate Identity
  const isCorporateAdmin = ['admin', 'superadmin', 'store-manager', 'store-cashier'].includes(req.user.role);
  const isCorporateClient = req.user.isCorporate === true;
  const corporateName = (isCorporateAdmin || isCorporateClient)
    ? (providedCorporateName || req.user.companyName || 'Corporate Client')
    : 'Family Group';

  const groupBookingId = `GRP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const bookings = [];
  let totalAmount = 0;

  // 2. Fetch Class for Pricing
  const classItem = await ClassModel.findById(classId);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }

  let singleTaxAmount = 0;
  let activeTax = null;

  if (classItem.taxId) {
    activeTax = await Tax.findById(classItem.taxId);
  } else if (locationId) {
    // Fallback to location-default active tax
    activeTax = await Tax.findOne({ 
      locationId, 
      status: 'active',
      $or: [
        { validityEnd: { $exists: false } },
        { validityEnd: { $gte: new Date() } }
      ]
    });
  }

  // Tax will be calculated per participant inside the distribution logic below
  // to account for post-discount/pro-rata price accurately.

  const distCoupon = (couponAmount || 0) / (resolvedSessionIds.length * participants.length);
  const distDisc = (discountAmount || 0) / (resolvedSessionIds.length * participants.length);
  const singleNetPrice = Math.max(0, classItem.price - distDisc - distCoupon);
  
  if (activeTax) {
    singleTaxAmount = calculateTax(singleNetPrice, activeTax);
  }

  // Final price for a single participant for one session
  const singleTotalAmount = activeTax?.calculationMethod === 'inclusive'
    ? singleNetPrice
    : singleNetPrice + singleTaxAmount;

  // 3. Process each session for each participant
  for (const sessionId of resolvedSessionIds) {
    const session = await Session.findById(sessionId);
    if (!session) {
      res.status(404);
      throw new Error(`Session ${sessionId} not found`);
    }

    // Check capacity for this session (Bypass for admins/staff)
    const userRole = (req.user.role || '').toLowerCase().replace(/[\s_-]/g, '');
    const isAdmin = ['admin', 'superadmin'].some(r => userRole === r) ||
      ['admin', 'manager', 'cashier'].some(r => userRole.includes(r));
    
    // LIVE COUNT Check: Don't trust the session.bookedParticipants field
    const liveBookedCount = await mongoose.model('Booking').countDocuments({
      sessionId: session._id,
      status: { $ne: 'cancelled' }
    });
    
    const remaining = session.capacity - liveBookedCount;
    
    if (participants.length > remaining && !isAdmin) {
      res.status(400);
      const msg = remaining <= 0 
        ? `Session on ${new Date(session.startTime).toLocaleString()} is full` 
        : `Session on ${new Date(session.startTime).toLocaleString()} has only ${remaining} spot${remaining > 1 ? 's' : ''} left.`;
      throw new Error(msg);
    }

    for (const p of participants) {
      const isStaff = !['parent', 'customer'].includes(userRole) || (req.user.permissions && req.user.permissions.length > 0);
      const isCash = paymentMethod === 'center_cash';

      const b = await Booking.create({
        userId: req.body.userId || req.user._id,
        classId,
        sessionId,
        locationId,
        participants: [{
          name: p.name,
          age: p.age,
          gender: p.gender,
          relation: p.relation,
          childId: p.childId
        }],
        date: session.startTime,
        totalAmount: singleTotalAmount,
        taxAmount: singleTaxAmount,
        taxId: activeTax?._id || classItem.taxId,
        paymentStatus: (paymentMethod === 'online' || (isStaff && isCash)) ? 'completed' : 'pending',
        paymentMethod: paymentMethod || 'center',
        status: (paymentMethod === 'online' || (isStaff && isCash)) ? 'confirmed' : 'pending',
        paymentDate: (isStaff && isCash) ? new Date() : undefined,
        processedBy: isStaff ? req.user._id : undefined,
        processedByRole: isStaff ? req.user.role : undefined,
        groupId: groupBookingId,
        isCorporate: isCorporateAdmin || isCorporateClient,
        corporateName,
        promotionId,
        discountAmount: (discountAmount || 0) / (resolvedSessionIds.length * participants.length), // Distributed discount
        couponCode,
        couponAmount: (couponAmount || 0) / (resolvedSessionIds.length * participants.length) // Distributed coupon
      });
      bookings.push(b);
      totalAmount += (classItem.price + singleTaxAmount);

      // Update session capacity (Self-syncing via countDocuments)
      // Removed manual increment

      // INVOICE GENERATION for each booking in the group
      const invoiceNumber = await getNextInvoiceNumber();

      const invoiceItems = [
        {
          description: `${classItem.title} - Group Booking (${p.name})`,
          quantity: 1,
          unitPrice: classItem.price,
          taxAmount: singleTaxAmount,
          total: classItem.price + singleTaxAmount
        }
      ];

      if (req.body.claimBogo) {
        invoiceItems.push({
          description: `BOGO Free Item - ${classItem.title}`,
          quantity: 1,
          unitPrice: 0,
          total: 0
        });
      }

      const distCoupon = (couponAmount || 0) / (resolvedSessionIds.length * participants.length);
      const distDisc = (discountAmount || 0) / (resolvedSessionIds.length * participants.length);
      const invoiceData = {
        invoiceNumber,
        bookingId: b._id,
        userId: b.userId,
        amount: singleTotalAmount,
        status: (paymentMethod === 'online' || (isStaff && isCash)) ? 'paid' : 'unpaid',
        locationId,
        taxAmount: singleTaxAmount,
        items: invoiceItems,
        discountAmount: distDisc,
        couponAmount: distCoupon,
        couponCode
      };

      if (distDisc > 0) {
         invoiceData.items.push({
            description: 'Promotion Discount (Pro-rata)',
            quantity: 1,
            unitPrice: -distDisc,
            total: -distDisc
         });
      }

      if (distCoupon > 0) {
        invoiceData.items.push({
           description: `Voucher Applied: ${couponCode} (Pro-rata)`,
           quantity: 1,
           unitPrice: -distCoupon,
           total: -distCoupon
        });
      }

      await Invoice.create(invoiceData);
    }
  }

  // 4. Create Consolidated SalesOrder (one per booking to match schema)
  for (const b of bookings) {
    try {
      await SalesOrder.create({
        bookingId: b._id,
        userId: req.body.userId || req.user._id,
        amount: b.totalAmount,
        status: paymentMethod === 'online' ? 'paid' : 'pending',
        locationId
      });
    } catch (soErr) {
      console.error('[SalesOrder] Failed to create for booking', b._id, soErr.message);
    }
  }

  // COUPON GENERATION LOGIC (Cash Deposit Promo) - Group Level
  if (promotionId) {
    const promo = await Promotion.findById(promotionId);
    if (promo && promo.promoType === 'cash_deposit') {
      const couponValue = (promo.discountType === 'percentage') 
        ? (totalAmount * (promo.discountValue / 100))
        : Math.min(totalAmount, promo.discountValue * participants.length * resolvedSessionIds.length);
      
      if (couponValue > 0) {
        const generatedCode = `CPN-G-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 90);

        await Coupon.create({
          code: generatedCode,
          userId: req.user._id,
          amount: Math.round(couponValue * 100) / 100,
          expiryDate,
          sourceBookingId: bookings[0]._id, // Reference first booking in group
          status: 'active'
        });
      }
    }
  }

  // COUPON REDEMPTION Logic
  if (req.body.couponCode) {
    const redeemedCoupon = await Coupon.findOne({ code: req.body.couponCode.toUpperCase(), status: 'active' });
    if (redeemedCoupon) {
      redeemedCoupon.status = 'redeemed';
      redeemedCoupon.redeemBookingId = bookings[0]._id;
      redeemedCoupon.redeemedAt = new Date();
      // Assign user if it was an anonymous voucher
      if (!redeemedCoupon.userId) {
        redeemedCoupon.userId = req.body.userId || req.user._id;
      }
      await redeemedCoupon.save();
    }
  }

  // 5. Create Consolidated Payment
  await Payment.create({
    userId: req.body.userId || req.user._id,
    amount: Math.round((totalAmount - (discountAmount || 0) - (req.body.couponAmount || 0)) * 100) / 100,
    discountAmount: discountAmount || 0,
    promotionId,
    paymentMethod: paymentMethod || 'center',
    status: paymentMethod === 'online' ? 'paid' : 'pending',
    locationId,
    groupId: groupBookingId,
    processedBy: req.user?._id
  });

  res.status(201).json({
    message: 'Group booking created successfully',
    groupId: groupBookingId,
    bookingCount: bookings.length,
    totalAmount,
    bookings: bookings.map(b => ({ _id: b._id, bookingNumber: b.bookingNumber }))
  });
});


export const sendReminder = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate('userId', 'name email firstName')
    .populate('classId', 'title')
    .populate({
      path: 'sessionId',
      select: 'startTime location classId',
      populate: { path: 'classId', select: 'title' }
    });

  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }

  // Fallback for classData: use booking.classId or session.classId
  const classData = booking.classId || booking.sessionId?.classId;
  const sessionData = booking.sessionId;
  const userData = booking.userId || booking.guestDetails;

  if (!classData || !classData.title) {
    res.status(400);
    throw new Error('Could not determine class details for this reminder');
  }

  if (!userData || (!userData.email && !booking.guestDetails?.email)) {
    res.status(400);
    throw new Error('No contact email found for this booking');
  }

  const sent = await sendSessionReminderEmail(booking, classData, sessionData, userData);

  if (!sent) {
    res.status(500);
    throw new Error('Failed to send reminder email');
  }

  res.json({ message: 'Reminder sent successfully' });
});
