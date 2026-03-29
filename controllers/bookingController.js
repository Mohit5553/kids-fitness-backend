import asyncHandler from 'express-async-handler';
import Booking from '../models/Booking.js';
import Session from '../models/Session.js';
import ClassModel from '../models/Class.js';
import SalesOrder from '../models/SalesOrder.js';
import Location from '../models/Location.js';
import { resolveReadLocationId } from '../utils/locationScope.js';
import { sendBookingConfirmationEmail, sendBookingUpdateEmail } from '../utils/mailer.js';
import User from '../models/User.js';

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
    .populate('classId', 'title price')
    .populate({ path: 'sessionId', populate: { path: 'trainerId', select: 'name' } })
    .populate('participants.childId', 'name age gender')
    .sort({ createdAt: -1 });
  res.json(bookings);
});

export const createBooking = asyncHandler(async (req, res) => {
  const { participants, classId, date, sessionId, paymentMethod, paymentStatus, guestDetails } = req.body;

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
    const remainingCapacity = session.capacity - session.bookedParticipants;
    if (participants.length > remainingCapacity) {
      res.status(400);
      throw new Error(`Only ${remainingCapacity} spots remaining in this session`);
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
    bookingData.userId = req.user._id;
  } else {
    bookingData.guestDetails = guestDetails;
  }

  const created = await Booking.create(bookingData);

  // If paying at center, generate a SalesOrder
  if (paymentMethod === 'center') {
    const orderData = {
      bookingId: created._id,
      amount: totalAmount,
      status: 'pending',
      locationId: resolvedLocationId
    };
    if (req.user) {
      orderData.userId = req.user._id;
    } else {
      orderData.guestDetails = guestDetails;
    }
    await SalesOrder.create(orderData);
  }

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
  booking.status = req.body.status || booking.status;
  const saved = await booking.save();

  // Send Status Update Email
  if (req.body.status) {
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

export const deleteBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }
  if (booking.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    res.status(403);
    throw new Error('Not allowed');
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
    // 1. Link Bookings
    const bookingResult = await Booking.updateMany(
      { userId: { $exists: false }, 'guestDetails.email': user.email },
      { $set: { userId: user._id } }
    );

    // 2. Link SalesOrders
    const orderResult = await SalesOrder.updateMany(
      { userId: { $exists: false }, 'guestDetails.email': user.email },
      { $set: { userId: user._id } }
    );

    console.log(`Linked ${bookingResult.modifiedCount} bookings and ${orderResult.modifiedCount} orders for ${user.email}`);
  } catch (error) {
    console.error(`Error linking guest bookings for ${user.email}:`, error);
  }
};
