import asyncHandler from 'express-async-handler';
import Booking from '../models/Booking.js';
import Session from '../models/Session.js';
import ClassModel from '../models/Class.js';
import SalesOrder from '../models/SalesOrder.js';
import Location from '../models/Location.js';
import { resolveReadLocationId } from '../utils/locationScope.js';
import { sendBookingConfirmationEmail, sendBookingUpdateEmail } from '../utils/mailer.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import Invoice from '../models/Invoice.js';

export const getMyBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({
    $or: [
      { userId: req.user._id },
      { 'guestDetails.email': req.user.email }
    ]
  })
    .populate('classId', 'title price')
    .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
    .sort({ createdAt: -1 });
  res.json(bookings);
});

export const getAllBookings = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const { sessionId, trainerId } = req.query;
  const filter = locationId ? { locationId } : {};
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

  res.json(filtered);
});

export const createBooking = asyncHandler(async (req, res) => {
  const { participants, classId, date, sessionId, paymentMethod, paymentStatus, guestDetails, userId } = req.body;

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

    // Capacity Check
    const remainingCapacity = session.capacity - (session.bookedParticipants || 0);
    if (participants.length > remainingCapacity) {
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
  const totalAmount = (classItem.price || 0) * participants.length;

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
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  const bookingNumber = `BK-${dateStr}-${randomStr}`;

  const bookingData = {
    bookingNumber,
    participants,
    classId: resolvedClassId,
    sessionId: resolvedSessionId,
    date: resolvedDate,
    totalAmount,
    locationId: resolvedLocationId,
    paymentMethod,
    paymentStatus,
    paymentDate: paymentStatus === 'completed' ? new Date() : undefined,
    status: paymentStatus === 'completed' ? 'confirmed' : 'pending'
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
    }
  } else {
    bookingData.guestDetails = guestDetails;
  }

  const created = await Booking.create(bookingData);

  // OFFICIAL INVOICE GENERATION
  const invYear = new Date().getFullYear();
  const invRandom = Math.floor(1000 + Math.random() * 9000);
  const invoiceNumber = `INV-${invYear}-${invRandom}`;

  const invoiceData = {
    invoiceNumber,
    bookingId: created._id,
    userId: created.userId,
    guestDetails: created.guestDetails,
    amount: totalAmount,
    status: created.status === 'confirmed' ? 'paid' : 'unpaid',
    locationId: resolvedLocationId,
    items: [
      {
        description: `${classItem.title} - Session Booking`,
        quantity: participants.length,
        unitPrice: classItem.price || 0,
        total: totalAmount
      }
    ]
  };
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
  await Payment.create({
    userId: created.userId,
    bookingId: created._id,
    amount: totalAmount,
    paymentMethod: paymentMethod || 'center',
    status: paymentMethod === 'online' ? 'paid' : 'pending',
    locationId: resolvedLocationId
  });

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

  res.status(201).json(created);
});



export const updateBookingStatus = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && booking.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }

  const oldStatus = booking.status;
  const { status, paymentMethod, reference } = req.body;
  
  // Sequential Workflow Validation
  if (status === 'attended' && booking.status !== 'confirmed') {
    res.status(400);
    throw new Error('Trainer cannot confirm attendance until payment is ' + booking.status);
  }
  if (status === 'completed' && booking.status !== 'attended') {
    res.status(400);
    throw new Error('Accounts cannot finalize until class attendance is verified');
  }

  // Handle capacity decrement on cancellation
  if (status === 'cancelled' && oldStatus !== 'cancelled' && booking.sessionId) {
    await Session.findByIdAndUpdate(booking.sessionId, {
      $inc: { bookedParticipants: -booking.participants.length }
    });
  }
  // Handle capacity increment if re-activating
  if (oldStatus === 'cancelled' && status && status !== 'cancelled' && booking.sessionId) {
    const session = await Session.findById(booking.sessionId);
    if (session) {
      const remaining = session.capacity - (session.bookedParticipants || 0);
      if (booking.participants.length > remaining) {
        res.status(400);
        throw new Error('Cannot restore booking: session is now full');
      }
      session.bookedParticipants += booking.participants.length;
      await session.save();
    }
  }

  // Update Lifecycle tracking
  const userRole = (req.user?.role || '').toLowerCase();
  booking.status = status || booking.status;

  if (status === 'confirmed') {
    booking.paymentStatus = 'completed';
    booking.lifecycle = { 
      ...booking.lifecycle, 
      paidAt: new Date(), 
      paidBy: req.user?._id 
    };

    // Sync status and transaction specifics back to Payment record
    const payRec = await Payment.findOne({ bookingId: booking._id });
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
  }

  if (status === 'attended') {
    booking.lifecycle = { 
      ...booking.lifecycle, 
      attendedAt: new Date(), 
      attendedBy: req.user?._id 
    };
  }

  if (status === 'completed') {
    booking.lifecycle = { 
      ...booking.lifecycle, 
      finalizedAt: new Date(), 
      finalizedBy: req.user?._id 
    };
  }

  // Record who processed the latest confirmation
  const isStaff = req.user && req.user.role !== 'parent' && req.user.role !== 'customer';
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

  // Revert capacity if not already cancelled
  if (booking.status !== 'cancelled' && booking.sessionId) {
    await Session.findByIdAndUpdate(booking.sessionId, {
      $inc: { bookedParticipants: -booking.participants.length }
    });
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
  const { participants, sessionIds, sessions, classId: providedClassId, locationId: providedLocationId, corporateName: providedCorporateName, paymentMethod } = req.body;

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

  // 3. Process each session for each participant
  for (const sessionId of sessionIds) {
    const session = await Session.findById(sessionId);
    if (!session) {
      res.status(404);
      throw new Error(`Session ${sessionId} not found`);
    }

    // Check capacity for this session
    const remaining = session.capacity - (session.bookedParticipants || 0);
    if (participants.length > remaining) {
      res.status(400);
      const msg = remaining <= 0 
        ? `Session on ${new Date(session.startTime).toLocaleString()} is full` 
        : `Session on ${new Date(session.startTime).toLocaleString()} has only ${remaining} spot${remaining > 1 ? 's' : ''} left.`;
      throw new Error(msg);
    }

    for (const p of participants) {
      const b = await Booking.create({
        userId: req.user._id,
        classId,
        sessionId,
        locationId,
        participantName: p.name,
        participantAge: p.age,
        participantGender: p.gender,
        relation: p.relation,
        childId: p.childId,
        date: session.startTime,
        totalAmount: classItem.price,
        paymentStatus: paymentMethod === 'online' ? 'completed' : 'pending',
        paymentMethod: paymentMethod || 'center',
        groupId: groupBookingId,
        isCorporate: isCorporateAdmin || isCorporateClient,
        corporateName
      });
      bookings.push(b);
      totalAmount += classItem.price;

      // Update session capacity
      session.bookedParticipants = (session.bookedParticipants || 0) + 1;
      await session.save();

      // INVOICE GENERATION for each booking in the group
      const invYear = new Date().getFullYear();
      const invRandom = Math.floor(1000 + Math.random() * 9000);
      const invoiceNumber = `INV-${invYear}-${invRandom}`;

      await Invoice.create({
        invoiceNumber,
        bookingId: b._id,
        userId: req.user._id,
        amount: classItem.price,
        status: paymentMethod === 'online' ? 'paid' : 'unpaid',
        locationId,
        items: [
          {
            description: `${classItem.title} - Group Booking (${p.name})`,
            quantity: 1,
            unitPrice: classItem.price,
            total: classItem.price
          }
        ]
      });
    }
  }

  // 4. Create Consolidated SalesOrder
  const salesOrder = await SalesOrder.create({
    userId: req.user._id,
    bookings: bookings.map(b => b._id),
    totalAmount,
    status: paymentMethod === 'online' ? 'completed' : 'pending',
    paymentMethod: paymentMethod || 'center',
    groupId: groupBookingId,
    corporateName
  });

  // 5. Create Consolidated Payment
  await Payment.create({
    userId: req.user._id,
    orderId: salesOrder._id,
    amount: totalAmount,
    paymentMethod: paymentMethod || 'center',
    status: paymentMethod === 'online' ? 'paid' : 'pending',
    locationId,
    groupId: groupBookingId
  });

  res.status(201).json({
    message: 'Group booking created successfully',
    groupId: groupBookingId,
    bookingCount: bookings.length,
    totalAmount,
    salesOrderId: salesOrder._id,
    bookings: bookings.map(b => ({ _id: b._id, bookingNumber: b.bookingNumber }))
  });
});

