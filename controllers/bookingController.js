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
          // If session is a 'Class', only show walk-in bookings (filter out virtual memberships)
          // Even if they are linked in the DB, we hide them to ensure strict separation.
          if (targetSession.classType === 'Class') {
              filtered = filtered.filter(b => !b.isVirtualMembership && b.bookingType !== 'package');
              return res.status(200).json(filtered); // Return early to avoid adding memberships
          } else {
              // If session is a 'Plan', only show membership-based students
              const relevantMemberships = await Membership.find({ 
                  generatedSessions: sessionId,
                  status: 'active'
              })
              .populate('userId', 'name email phone')
              .populate('childId')
              .populate('planId', 'name');

              const attendances = await Attendance.find({ sessionId });
              const attendedMemberIds = attendances.map(a => a.membershipId?.toString()).filter(Boolean);

              // Clear non-membership bookings from a 'Plan' session (just in case they were misassigned)
              filtered = filtered.filter(b => b.isVirtualMembership || b.bookingType === 'package');

              relevantMemberships.forEach(membership => {
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

      if (activeMembership && activeMembership.status === 'frozen') {
         res.status(400);
         throw new Error('Your membership is currently frozen. Please unfreeze it to book classes.');
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
    const creditCost = session?.classId?.creditCost || 1;

    if (!existingAttendance && ['attended', 'no-show'].includes(status)) {
      if (membership.classesRemaining !== -1 && membership.classesRemaining > 0) membership.classesRemaining -= 1;
      if (membership.creditsRemaining > 0) membership.creditsRemaining = Math.max(0, membership.creditsRemaining - creditCost);
      await membership.save();
    }

    await Attendance.findOneAndUpdate(filter, { ...filter, participantName: membership.childId?.name || membership.userId?.name, locationId: membership.locationId, status: status === 'attended' ? 'present' : 'absent', method: 'manual', checkedInAt: new Date() }, { upsert: true, new: true });
    return res.json({ message: 'Attendance recorded', classesRemaining: membership.classesRemaining, creditsRemaining: membership.creditsRemaining });
  }

  const booking = await Booking.findById(id);
  if (!booking) throw new Error('Booking not found');
  booking.status = status || booking.status;
  if (status === 'confirmed') {
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
  }
  const saved = await booking.save();
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
        bookingType: 'package', // Force package type for de-duplication/UI
        status: paymentMethod === 'online' ? 'confirmed' : 'pending',
        paymentStatus: paymentMethod === 'online' ? 'completed' : 'pending'
      });
      bookings.push(b);
      totalAmount += singleTotal;
    }
  }

  await Payment.create({ userId: req.body.userId || req.user._id, amount: totalAmount, groupId: groupBookingId, status: paymentMethod === 'online' ? 'paid' : 'pending', locationId });
  res.status(201).json({ groupBookingId, bookingCount: bookings.length, totalAmount });
});

export const sendReminder = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate('userId sessionId classId');
  if (!booking) throw new Error('Booking not found');
  const classData = booking.classId || booking.sessionId?.classId;
  const sent = await sendSessionReminderEmail(booking, classData, booking.sessionId, booking.userId || booking.guestDetails);
  res.json({ message: sent ? 'Reminder sent' : 'Failed to send' });
});
