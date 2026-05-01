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
  const { sessionId, trainerId, userId, childId, corporateName, groupId } = req.query;

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

  let filtered = [...bookings];
  if (corporateName) {
    filtered = filtered.filter(b => b.corporateName?.toLowerCase().includes(corporateName.toLowerCase()));
  }
  if (groupId) {
    filtered = filtered.filter(b => b.groupId === groupId);
  }

  if (sessionId) {
    const targetSession = await Session.findById(sessionId);
    if (targetSession) {
      // Look for ALL memberships linked to this session, regardless of session type
      const relevantMemberships = await Membership.find({
        generatedSessions: sessionId
      })
        .populate('userId', 'name email phone')
        .populate('childId')
        .populate('planId', 'name')
        .populate('bookingId', 'bookingNumber status');

      const attendances = await Attendance.find({ sessionId });
      const attendedMemberIds = attendances.map(a => a.membershipId?.toString()).filter(Boolean);

      relevantMemberships.forEach(membership => {
        const alreadyExists = filtered.some(b =>
          (b.membershipId && b.membershipId.toString() === membership._id.toString()) ||
          (b._id === `MR-${membership._id}-${sessionId}`)
        );

        if (!alreadyExists) {
          const isAttended = attendedMemberIds.includes(membership._id.toString());

          // Use the linked booking status (Pending/Confirmed/etc.)
          // Default to 'confirmed' if no booking found (fallback)
          const bookingStatus = isAttended ? 'attended' : (membership.bookingId?.status || 'confirmed');

          const virtualBooking = {
            _id: `MR-${membership._id}-${sessionId}`,
            bookingNumber: membership.bookingId?.bookingNumber || `MBR-${membership._id.toString().slice(-6).toUpperCase()}`,
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
            status: bookingStatus,
            paymentStatus: membership.bookingId?.status === 'confirmed' ? 'completed' : 'pending',
            createdAt: membership.createdAt,
            locationId: membership.locationId,
            membershipId: membership._id,
            planId: membership.planId,
            isVirtualMembership: true,
            packageInfo: {
              name: membership.planId?.name,
              childName: membership.childId?.name,
              parentName: membership.userId?.name
            }
          };
          filtered.unshift(virtualBooking);
        }
      });
    }
  }

  // For package bookings in the main list, attach their membership info
  const packageBookings = filtered.filter(b => b.bookingType === 'package' && !b.isVirtualMembership);
  if (packageBookings.length > 0) {
    const bookingIds = packageBookings.map(b => b._id);
    const memberships = await Membership.find({ bookingId: { $in: bookingIds } });

    // Map and return, ensuring all items are preserved
    filtered = filtered.map(b => {
      if (b.bookingType === 'package' && !b.isVirtualMembership) {
        const plain = b.toObject ? b.toObject() : { ...b };
        const mbr = memberships.find(m => String(m.bookingId) === String(b._id));
        if (mbr) {
          plain.membershipEndDate = mbr.endDate;
          plain.classesRemaining = mbr.classesRemaining;
        }
        return plain;
      }
      return b;
    });
  }

  // AUTO-COMPLETE DISPLAY LOGIC
  const now = new Date();
  filtered = filtered.map(b => {
    const bookingDate = b.date || b.sessionId?.startTime;
    if (b.status === 'attended' && bookingDate && new Date(bookingDate) < now) {
      // If it's a plain search result, it might be a Mongoose object, so convert it
      const plain = b.toObject ? b.toObject() : { ...b };
      plain.status = 'completed';
      return plain;
    }
    return b;
  });

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

    const bookingUserRole = (req.user?.role || '').toLowerCase().replace(/[\s_-]/g, '');
    const isStaffBooking = ['admin', 'manager', 'cashier'].some(r => bookingUserRole.includes(r));

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

    const targetUserIdForLimit = userId || req.user?._id;
    if (targetUserIdForLimit && !isStaffBooking) {
      const activeMembership = await Membership.findOne({
        userId: targetUserIdForLimit,
        status: 'active',
        $or: [
          { childId: { $in: participants.map(p => p.childId).filter(Boolean) } },
          { childId: null }
        ]
      }).populate('planId');

      if (activeMembership && activeMembership.planId?.dailyBookingLimit > 0) {
        const startOfDay = new Date(resolvedDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(resolvedDate);
        endOfDay.setHours(23, 59, 59, 999);

        const dailyCounts = await Booking.countDocuments({
          userId: targetUserIdForLimit,
          date: { $gte: startOfDay, $lte: endOfDay },
          status: { $ne: 'cancelled' }
        });

        if (dailyCounts + participants.length > activeMembership.planId.dailyBookingLimit) {
          res.status(400);
          throw new Error(`Daily booking limit reached (${activeMembership.planId.dailyBookingLimit} sessions/day). You have already booked ${dailyCounts} session(s) for this day.`);
        }
      }

    }

    if (activeMembership && activeMembership.status === 'frozen') {
      res.status(400);
      throw new Error('Your membership is currently frozen. Please unfreeze it to book classes.');
    }

    // DUPLICATE BOOKING CHECK
    const targetChildIds = participants.map(p => p.childId).filter(Boolean);
    const hasSelfBooking = participants.some(p => p.relation === 'Self');

    const duplicateFilter = {
      sessionId: resolvedSessionId,
      status: { $ne: 'cancelled' },
      $or: []
    };

    if (targetChildIds.length > 0) {
      duplicateFilter.$or.push({ 'participants.childId': { $in: targetChildIds } });
    }
    if (hasSelfBooking) {
      duplicateFilter.$or.push({ userId: targetUserIdForLimit, 'participants.relation': 'Self' });
    }

    if (duplicateFilter.$or.length > 0) {
      const existingBooking = await Booking.findOne(duplicateFilter);
      if (existingBooking) {
        res.status(400);
        throw new Error('One or more participants are already booked for this session.');
      }
    }
  }

  const classItem = await ClassModel.findById(resolvedClassId);
  if (!classItem) {
    res.status(404);
    throw new Error('Class not found');
  }

  if (!resolvedLocationId) resolvedLocationId = classItem.locationId;
  const discountAmount = Number(req.body.discountAmount) || 0;
  const couponAmount = Number(req.body.couponAmount) || 0;
  const rawBaseAmount = (classItem.price || 0) * participants.length;
  const netBaseAmount = Math.max(0, rawBaseAmount - discountAmount - couponAmount);

  let taxAmount = 0;
  let activeTax = null;
  if (classItem.taxId) {
    activeTax = await Tax.findById(classItem.taxId);
  } else if (resolvedLocationId) {
    activeTax = await Tax.findOne({
      locationId: resolvedLocationId,
      status: 'active',
      $or: [{ validityEnd: { $exists: false } }, { validityEnd: { $gte: new Date() } }]
    });
  }
  if (activeTax) taxAmount = calculateTax(netBaseAmount, activeTax);
  const totalAmount = activeTax?.calculationMethod === 'inclusive' ? netBaseAmount : netBaseAmount + taxAmount;

  const bookingNumber = `BK-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 12).toUpperCase()}`;

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
    discountAmount: discountAmount || 0,
    couponCode: req.body.couponCode,
    couponAmount: req.body.couponAmount || 0
  };

  if (req.user) {
    const userRoleLower = (req.user.role || '').toLowerCase().trim();
    const isStaff = !['parent', 'customer'].includes(userRoleLower) || (req.user.permissions && req.user.permissions.length > 0);
    bookingData.userId = (isStaff && userId) ? userId : req.user._id;
    if (isStaff) {
      bookingData.processedBy = req.user._id;
      bookingData.processedByRole = req.user.role;
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

  // COUPON REDEMPTION LOGIC
  if (req.body.couponCode) {
    const coupon = await Coupon.findOne({ code: req.body.couponCode.toUpperCase(), status: 'active' });
    if (coupon) {
      coupon.status = 'redeemed';
      coupon.redeemBookingId = created._id;
      coupon.redeemedAt = new Date();
      // Link user if not already set
      if (!coupon.userId && created.userId) {
        coupon.userId = created.userId;
      }
      await coupon.save();
    }
  }

  const invoiceNumber = await getNextInvoiceNumber();
  const invoiceItems = [{ description: `${classItem.title} - Session Booking`, quantity: participants.length, unitPrice: classItem.price || 0, total: (classItem.price || 0) * participants.length }];
  if (req.body.claimBogo) invoiceItems.push({ description: `BOGO Free Item - ${classItem.title}`, quantity: participants.length, unitPrice: 0, total: 0 });
  if (discountAmount > 0) invoiceItems.push({ description: 'Promotion Discount', quantity: 1, unitPrice: -discountAmount, total: -discountAmount });
  if (req.body.couponAmount > 0) invoiceItems.push({ description: `Cash Voucher Applied (${req.body.couponCode})`, quantity: 1, unitPrice: -req.body.couponAmount, total: -req.body.couponAmount });

  await Invoice.create({
    invoiceNumber,
    bookingId: created._id,
    userId: created.userId,
    guestDetails: created.guestDetails,
    amount: totalAmount,
    grossAmount: (classItem.price || 0) * participants.length,
    totalAmount,
    status: created.status === 'confirmed' ? 'paid' : 'unpaid',
    locationId: resolvedLocationId,
    items: invoiceItems,
    taxAmount,
    discountAmount: discountAmount || 0,
    couponAmount: req.body.couponAmount || 0,
    couponCode: req.body.couponCode
  });

  if (paymentMethod === 'center') {
    await SalesOrder.create({
      bookingId: created._id,
      userId: created.userId,
      guestDetails: created.guestDetails,
      amount: totalAmount,
      status: 'pending',
      locationId: resolvedLocationId
    });
  }

  await Payment.create({
    userId: created.userId,
    bookingId: created._id,
    amount: totalAmount,
    discountAmount,
    couponCode: req.body.couponCode,
    couponAmount,
    paymentMethod: paymentMethod || 'center',
    status: paymentMethod === 'online' ? 'paid' : 'pending',
    locationId: resolvedLocationId,
    processedBy: req.user?._id
  });

  if (session) {
    session.bookedParticipants += participants.length;
    await session.save();
  }

  const userForEmail = req.user || { name: guestDetails.name, email: guestDetails.email };
  sendBookingConfirmationEmail(created, classItem, userForEmail).catch(err => console.error('Booking confirmation email failed:', err.message));

  // EMIT: Notify admin room about new booking
  const io = req.app.get('socketio');
  if (io) {
    const LocationModel = mongoose.model('Location');
    const loc = await LocationModel.findById(resolvedLocationId);
    io.to('admin_room').emit('new_booking', {
      bookingNumber: created.bookingNumber,
      customerName: guestDetails?.name || req.user?.name || 'Customer',
      locationName: loc?.name || 'Main Center',
      totalAmount: created.totalAmount
    });
  }

  // If it's a package booking, ensure membership and sessions are created
  if (classItem.classType === 'Plan') {
    const MembershipModel = mongoose.model('Membership');
    const membership = await MembershipModel.findOne({ bookingId: created._id });
    if (membership) {
      const { generateMembershipSessions } = await import('../services/schedulingService.js');
      const sessionIds = await generateMembershipSessions(membership, classItem);
      membership.generatedSessions = [...new Set([...(membership.generatedSessions || []), ...sessionIds])];
      await membership.save();
    }
  }

  res.status(201).json(created);
});

export const updateBookingStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, paymentMethod, reference } = req.body;

  if (id.startsWith('MR-')) {
    const parts = id.split('-');
    const membershipId = parts[1];
    const sessionId = parts[2];
    const membership = await Membership.findById(membershipId).populate('userId childId');
    if (!membership) throw new Error('Membership not found');
    const filter = { sessionId, membershipId: membership._id };
    if (membership.childId) filter.childId = membership.childId._id;
    else filter.userId = membership.userId?._id;

    const existingAttendance = await Attendance.findOne(filter);
    const session = await Session.findById(sessionId).populate('classId');

    // LOCK LOGIC FOR MEMBERSHIP SESSIONS
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (existingAttendance && (existingAttendance.status === 'present' || existingAttendance.status === 'completed')) {
      res.status(400);
      throw new Error('Attendance has already been marked as complete and cannot be changed.');
    }

    // LOCK LOGIC FOR MEMBERSHIP SESSIONS (Virtual Bookings)
    // For single check-ins, we lock if the session date has passed.
    if (session && new Date(session.startTime) < startOfToday) {
      res.status(400);
      throw new Error('This session has already passed and its attendance cannot be changed.');
    }

    const creditCost = session?.classId?.creditCost || 1;

    if (!existingAttendance && ['attended', 'no-show'].includes(status)) {
      if (membership.classesRemaining !== -1 && membership.classesRemaining > 0) membership.classesRemaining -= 1;
      if (membership.creditsRemaining > 0) membership.creditsRemaining = Math.max(0, membership.creditsRemaining - creditCost);
      await membership.save();
    }

    // Auto-switch 'attended' to 'completed' for memberships
    const targetStatus = status === 'attended' ? 'completed' : status;

    await Attendance.findOneAndUpdate(filter, {
      ...filter,
      userId: membership.userId?._id || membership.userId,
      bookingId: membership.bookingId?._id || membership.bookingId,
      participantName: membership.childId?.name || membership.userId?.name,
      locationId: membership.locationId,
      status: (targetStatus === 'attended' || targetStatus === 'completed') ? 'present' : 'absent',
      method: 'manual',
      checkedInAt: new Date()
    }, { upsert: true, new: true });
    return res.json({ message: 'Attendance recorded', classesRemaining: membership.classesRemaining, creditsRemaining: membership.creditsRemaining });
  }

  const booking = await Booking.findById(id);
  if (!booking) throw new Error('Booking not found');

  if (booking.status === 'completed') {
    res.status(400);
    throw new Error('This booking is already completed and cannot be changed.');
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // LOCK LOGIC - DIFFERENTIATE SESSION VS PACKAGE
  if (booking.bookingType === 'session') {
    // For single sessions, lock if the date has passed
    if (new Date(booking.date) < startOfToday) {
      res.status(400);
      throw new Error('The date for this session has passed and its status cannot be changed.');
    }
  } else if (booking.bookingType === 'package') {
    // For memberships, lock ONLY if the schedule is actually complete
    const mbr = await mongoose.model('Membership').findOne({ bookingId: booking._id });
    if (mbr) {
      const isExpired = mbr.endDate && new Date(mbr.endDate) < startOfToday;
      const isUsedUp = mbr.classesRemaining === 0;
      if (isExpired || isUsedUp) {
        res.status(400);
        const reason = isExpired ? 'This membership has expired' : 'This membership has no classes remaining';
        throw new Error(`${reason} and its status cannot be changed.`);
      }
    }
  }

  if (status === 'cancelled' && booking.status !== 'cancelled') {
    if (booking.sessionId) {
      const session = await Session.findById(booking.sessionId);
      if (session && session.bookedParticipants > 0) {
        session.bookedParticipants = Math.max(0, session.bookedParticipants - (booking.participants?.length || 1));
        await session.save();
      }
    } else if (booking.bookingType === 'package') {
      // Handle membership session occupancy decrement
      const memberships = await mongoose.model('Membership').find({ bookingId: booking._id });
      for (const m of memberships) {
        if (m.generatedSessions && m.generatedSessions.length > 0) {
          await Session.updateMany(
            { _id: { $in: m.generatedSessions }, startTime: { $gte: new Date() }, bookedParticipants: { $gt: 0 } },
            { $inc: { bookedParticipants: -1 } }
          );
        }
      }
    }
  }

  if (status === 'pending' && booking.status !== 'pending') {
    res.status(400);
    throw new Error('Cannot change status back to pending once it has been confirmed or processed.');
  }

  const finalStatus = status === 'attended' ? 'completed' : status;
  booking.status = finalStatus || booking.status;
  if (finalStatus === 'confirmed') {
    booking.paymentStatus = 'completed';
    const payRec = await Payment.findOne({ $or: [{ bookingId: booking._id }, { groupId: booking.groupId }] });
    if (payRec) {
      payRec.status = 'paid';
      payRec.paymentMethod = paymentMethod ? `center_${paymentMethod}` : 'center';
      if (reference) payRec.reference = reference;
      await payRec.save();
    }
    const inv = await Invoice.findOne({ bookingId: booking._id });
    if (inv) { inv.status = 'paid'; await inv.save(); }

    // Re-trigger session generation to catch today's session (now with grace period)
    if (booking.bookingType === 'package') {
      const MembershipModel = mongoose.model('Membership');
      const PlanModel = mongoose.model('Plan');
      const membership = await MembershipModel.findOne({ bookingId: booking._id });
      const plan = await PlanModel.findById(booking.planId);
      if (membership && plan) {
        const { generateMembershipSessions } = await import('../services/schedulingService.js');
        const sessionIds = await generateMembershipSessions(membership, plan);
        membership.generatedSessions = [...new Set([...(membership.generatedSessions || []), ...sessionIds])];
        await membership.save();
      }
    }
  }
  const saved = await booking.save();

  // EMIT: Notify admin room (including trainers/cashiers) that a booking has been updated
  const io = req.app.get('socketio');
  if (io) {
    io.to('admin_room').emit('booking_updated', {
      bookingId: saved._id,
      status: saved.status,
      paymentStatus: saved.paymentStatus
    });
  }

  res.json(saved);
});

export const requestRefund = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new Error('Booking not found');
  if (booking.userId.toString() !== req.user._id.toString()) throw new Error('Not authorized');
  const isPaid = booking.paymentStatus === 'completed' || booking.status === 'confirmed';
  if (!isPaid) throw new Error('Only paid bookings can be refunded');
  if (new Date() >= new Date(booking.date)) throw new Error('Refunds must be requested before session starts');
  booking.refundStatus = 'requested';
  await booking.save();
  res.json({ message: 'Refund request submitted' });
});

export const resolveRefundRequest = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new Error('Booking not found');
  if (status === 'refunded') {
    booking.refundStatus = 'refunded';
    booking.status = 'cancelled';
    const invoiceRec = await Invoice.findOne({ bookingId: booking._id });
    if (invoiceRec) { invoiceRec.status = 'cancelled'; await invoiceRec.save(); }
  } else if (status === 'declined') {
    if (!reason) throw new Error('Rejection reason required');
    booking.refundStatus = 'declined';
    booking.refundRejectionReason = reason;
  }
  await booking.save();
  res.json({ message: `Refund request ${status}` });
});

export const lookupGuestBooking = asyncHandler(async (req, res) => {
  const { email, bookingNumber } = req.query;
  const booking = await Booking.findOne({
    bookingNumber: bookingNumber.toUpperCase(),
    $or: [
      { 'guestDetails.email': new RegExp(`^${email}$`, 'i') },
      { userId: await User.findOne({ email: new RegExp(`^${email}$`, 'i') }).select('_id') }
    ]
  }).populate('classId sessionId locationId');
  if (!booking) throw new Error('Booking not found');
  res.json(booking);
});

export const deleteBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new Error('Booking not found');
  const isAdmin = ['admin', 'superadmin', 'store-manager', 'store-cashier'].includes(req.user.role);
  if (!isAdmin && booking.userId.toString() !== req.user._id.toString()) throw new Error('Not allowed');

  // Decrement occupancy if it was a Confirmed session booking
  if (booking.status !== 'cancelled') {
    if (booking.sessionId) {
      const session = await Session.findById(booking.sessionId);
      if (session && session.bookedParticipants > 0) {
        session.bookedParticipants = Math.max(0, session.bookedParticipants - (booking.participants?.length || 1));
        await session.save();
      }
    } else if (booking.bookingType === 'package') {
      // Handle membership session occupancy decrement
      const memberships = await Membership.find({ bookingId: booking._id });
      for (const m of memberships) {
        if (m.generatedSessions && m.generatedSessions.length > 0) {
          await Session.updateMany(
            { _id: { $in: m.generatedSessions }, startTime: { $gte: new Date() }, bookedParticipants: { $gt: 0 } },
            { $inc: { bookedParticipants: -1 } }
          );
        }
      }
    }
  }

  await booking.deleteOne();
  res.json({ message: 'Booking removed' });
});

export const linkUserBookings = async (user) => {
  if (!user || !user.email) return;
  const emailRegex = new RegExp(`^${user.email}$`, 'i');
  await Booking.updateMany({ userId: { $exists: false }, 'guestDetails.email': emailRegex }, { $set: { userId: user._id } });
  await SalesOrder.updateMany({ userId: { $exists: false }, 'guestDetails.email': emailRegex }, { $set: { userId: user._id } });
  const bookingIds = await Booking.find({ userId: user._id }).distinct('_id');
  await Payment.updateMany({ userId: { $exists: false }, $or: [{ 'guestDetails.email': emailRegex }, { bookingId: { $in: bookingIds } }] }, { $set: { userId: user._id } });
};

export const createGroupBooking = asyncHandler(async (req, res) => {
  const { participants, sessionIds, sessions, classId: providedClassId, locationId: providedLocationId, corporateName: providedCorporateName, paymentMethod, promotionId, discountAmount, couponCode, couponAmount } = req.body;
  const resolvedSessionIds = sessionIds || sessions;
  if (!participants?.length || !resolvedSessionIds?.length) throw new Error('Missing details');

  let classId = providedClassId;
  let locationId = providedLocationId;
  if (!classId || !locationId) {
    const s1 = await Session.findById(resolvedSessionIds[0]);
    classId = providedClassId || s1?.classId;
    locationId = providedLocationId || s1?.locationId;
  }
  const classItem = await ClassModel.findById(classId);
  const groupBookingId = `GRP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const bookings = [];
  let totalAmount = 0;

  const count = resolvedSessionIds.length * participants.length;
  const dDisc = (discountAmount || 0) / count;
  const dCoup = (couponAmount || 0) / count;
  const activeTax = await Tax.findOne({ locationId, status: 'active' });
  const singleNet = Math.max(0, classItem.price - dDisc - dCoup);
  const singleTax = activeTax ? calculateTax(singleNet, activeTax) : 0;
  const singleTotal = activeTax?.calculationMethod === 'inclusive' ? singleNet : singleNet + singleTax;

  for (const sessionId of resolvedSessionIds) {
    const sess = await Session.findById(sessionId);
    for (const p of participants) {
      const b = await Booking.create({
        userId: req.body.userId || req.user._id,
        classId,
        sessionId,
        locationId,
        participants: [p],
        date: sess.startTime,
        totalAmount: singleTotal,
        taxAmount: singleTax,
        groupId: groupBookingId,
        bookingType: 'session', // Default to session for group/walking bookings
        status: paymentMethod === 'online' ? 'confirmed' : 'pending',
        paymentStatus: paymentMethod === 'online' ? 'completed' : 'pending'
      });
      bookings.push(b);
      totalAmount += singleTotal;
    }
  }

  // COUPON REDEMPTION LOGIC
  if (couponCode) {
    const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), status: 'active' });
    if (coupon) {
      coupon.status = 'redeemed';
      coupon.redeemBookingId = bookings[0]?._id;
      coupon.redeemedAt = new Date();
      // Link user if not already set
      const targetUserId = req.body.userId || req.user?._id;
      if (!coupon.userId && targetUserId) {
        coupon.userId = targetUserId;
      }
      await coupon.save();
    }
  }

  await Payment.create({ userId: req.body.userId || req.user._id, amount: totalAmount, groupId: groupBookingId, status: paymentMethod === 'online' ? 'paid' : 'pending', locationId });
  res.status(201).json({ groupBookingId, bookingCount: bookings.length, totalAmount });
});

export const sendReminder = asyncHandler(async (req, res) => {
  const { sessionId } = req.query;

  // 1. Try to find as a regular booking first
  const booking = await Booking.findById(req.params.id)
    .populate('userId', 'name email firstName')
    .populate('sessionId')
    .populate('classId', 'title name');

  if (!booking) {
    // 2. Try to find as a membership (Virtual Booking)
    const membership = await Membership.findById(req.params.id)
      .populate('userId', 'name email firstName')
      .populate('childId', 'name')
      .populate('planId', 'name');

    if (!membership) {
      res.status(404);
      throw new Error('Record not found');
    }

    if (!sessionId) {
      res.status(400);
      throw new Error('Session ID is required for membership reminders');
    }

    const session = await Session.findById(sessionId).populate('classId', 'title name');
    if (!session) throw new Error('Session not found');

    const sent = await sendSessionReminderEmail(membership, membership.planId || session.classId, session, membership.userId);
    return res.json({ message: sent ? 'Reminder sent' : 'Failed to send' });
  }

  // Handle standard booking
  const classData = booking.classId || booking.sessionId?.classId;
  const sessionData = booking.sessionId;
  // If sessionData was already populated, we use it directly
  const sent = await sendSessionReminderEmail(booking, classData, sessionData, booking.userId || booking.guestDetails);
  res.json({ message: sent ? 'Reminder sent' : 'Failed to send' });
});
