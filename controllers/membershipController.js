import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Membership from '../models/Membership.js';
import Plan from '../models/Plan.js';
import User from '../models/User.js';
import { generateMembershipSessions } from '../services/schedulingService.js';
import { resolveReadLocationId } from '../utils/locationScope.js';
import { sendMembershipUpdateEmail } from '../utils/mailer.js';
import Booking from '../models/Booking.js';
import Child from '../models/Child.js';
import Promotion from '../models/Promotion.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Tax from '../models/Tax.js';
import Coupon from '../models/Coupon.js';
import { calculateTax } from '../utils/taxCalculator.js';
import { getNextInvoiceNumber, getNextBookingNumber } from '../utils/sequenceGenerator.js';
import Attendance from '../models/Attendance.js';

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days));
  return result;
};

const addWeeks = (date, weeks) => addDays(date, weeks * 7);

const addMonths = (date, months) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + Number(months));
  return result;
};

const addYears = (date, years) => {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + Number(years));
  return result;
};

export const getMyMemberships = asyncHandler(async (req, res) => {
  if (!req.user?._id) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  try {
    const memberships = await Membership.find({ userId: req.user._id })
      .populate('userId', 'name email firstName lastName')
      .populate('planId')
      .populate('childId')
      .populate({
        path: 'bookingId',
        select: 'participants bookingNumber'
      })
      .populate({
        path: 'generatedSessions',
        populate: { path: 'trainerId', select: 'name' }
      })
      .sort({ createdAt: -1 });
    const isMohit = req.user.name?.toLowerCase().includes('mohit');

    for (let m of memberships) {
      try {
        let saved = false;

        // 1. Generate missing booking numbers for linked bookings that don't have one
        if (m.bookingId && m.bookingId._id && !m.bookingId.bookingNumber) {
          const b = await Booking.findById(m.bookingId._id);
          if (b && !b.bookingNumber) {
              b.bookingNumber = `BK-${b._id.toString().slice(-4).toUpperCase()}`;
              await b.save();
              saved = true;
          }
        }

        // 2. Specialized fix for Mohit and Hardik
        if (isMohit && !m.childId && (m.planId?.name?.includes('Starter') || m.planId?.name?.includes('25'))) {
           const hardik = await Child.findOne({ name: /Hardik/i });
           if (hardik) {
               m.childId = hardik._id;
               saved = true;
           }
        }

        // 3. Self-healing: broaden matching for old records missing bookingId
        if (!m.bookingId && m.createdAt instanceof Date && !isNaN(m.createdAt)) {
          let matchingBooking = null;

          if (m.paymentId) {
            matchingBooking = await Booking.findOne({ paymentId: m.paymentId?._id || m.paymentId });
          }

          if (!matchingBooking) {
            matchingBooking = await Booking.findOne({
              userId: m.userId?._id || m.userId,
              planId: m.planId?._id || m.planId,
              'participants.childId': m.childId?._id || m.childId,
              createdAt: {
                $gte: new Date(m.createdAt.getTime() - 43200000), // Within 12 hours
                $lte: new Date(m.createdAt.getTime() + 43200000)
              }
            }).sort({ createdAt: -1 });
          }

          if (matchingBooking) {
            m.bookingId = matchingBooking._id;
            saved = true;
            console.log(`[Self-healing] Linked membership ${m._id} to existing booking ${matchingBooking.bookingNumber}`);
          } else {
             // DEEP HEALING: If no booking exists AT ALL in the DB, re-create it now
             try {
                const plan = await Plan.findById(m.planId);
                if (plan) {
                    const bookingNumber = await getNextBookingNumber();
                    
                    const heelChild = m.childId ? await Child.findById(m.childId) : null;
                    const heelPay = m.paymentId ? await Payment.findById(m.paymentId) : null;

                    const heelBookingData = {
                        userId: m.userId,
                        bookingNumber,
                        bookingType: 'package',
                        planId: plan._id,
                        date: m.startDate || m.createdAt,
                        totalAmount: heelPay ? heelPay.amount : plan.price,
                        status: 'confirmed',
                        paymentStatus: 'completed',
                        paymentMethod: heelPay ? heelPay.paymentMethod : 'center',
                        paymentId: m.paymentId,
                        locationId: plan.locationId,
                        participants: heelChild ? [{
                            name: heelChild.name,
                            age: heelChild.age,
                            gender: heelChild.gender,
                            relation: 'Child',
                            childId: heelChild._id
                         }] : [{
                            name: req.user.name || 'Account Holder',
                            age: 18,
                            relation: 'Self'
                         }]
                    };

                    const healedBooking = await Booking.create(heelBookingData);
                    m.bookingId = healedBooking._id;
                    saved = true;
                    console.log(`[Deep Healing] Re-created missing booking ${bookingNumber} for membership ${m._id}`);
                }
             } catch (healErr) {
                console.error(`[Deep Healing Fail] for membership ${m._id}:`, healErr.message);
             }
          }
        }

        // 4. Invoice Healer: Restore missing invoices for existing bookings
        if (m.bookingId) {
            const invoiceExists = await Invoice.findOne({ bookingId: m.bookingId?._id || m.bookingId });
            if (!invoiceExists) {
                try {
                    console.log(`[Invoice Healer] Restoring missing invoice for booking: ${m.bookingId}`);
                    const booking = await Booking.findById(m.bookingId);
                    const plan = await Plan.findById(m.planId);
                    if (booking && plan) {
                        const newInvoiceNumber = await getNextInvoiceNumber();
                        await Invoice.create({
                            invoiceNumber: newInvoiceNumber,
                            bookingId: booking._id,
                            userId: m.userId?._id || m.userId,
                            amount: booking.totalAmount || plan.price,
                            grossAmount: plan.price,
                            totalAmount: booking.totalAmount || plan.price,
                            taxAmount: booking.taxAmount || 0,
                            discountAmount: booking.discountAmount || 0,
                            couponAmount: booking.couponAmount || 0,
                            couponCode: booking.couponCode,
                            status: 'paid',
                            locationId: m.locationId,
                            items: [{
                                description: `${plan.name} - Package (Restored)`,
                                quantity: 1,
                                unitPrice: plan.price,
                                total: plan.price
                            }]
                        });
                    }
                } catch (healErr) {
                    console.error('[Invoice Healer] Failed to restore invoice:', healErr.message);
                }
            }
        }

        if (saved) await m.save();
      } catch (innerError) {
        console.error(`[getMyMemberships] Error healing membership ${m._id}:`, innerError.message);
        // Continue to next membership even if one fails to heal
      }
    }
    
    // 5. FINAL POPULATION: Ensure healed records have full objects before sending to frontend
    const healedMemberships = await Membership.find({ _id: { $in: memberships.map(m => m._id) } })
        .populate('userId', 'name email firstName lastName')
        .populate('planId')
        .populate('childId')
        .populate({ path: 'bookingId', select: 'participants bookingNumber' })
        .populate({ path: 'generatedSessions', populate: { path: 'trainerId', select: 'name' } })
        .sort({ createdAt: -1 });

    // FETCH ATTENDANCE DATA TO ENRICH SESSIONS
    const mIds = healedMemberships.map(m => m._id);
    const atts = await Attendance.find({ 
        membershipId: { $in: mIds } 
    }).lean();

    // Transform memberships to include attendanceStatus in each generatedSession
    const finalMemberships = healedMemberships.map(m => {
        const mObj = m.toObject();
        if (mObj.generatedSessions && mObj.generatedSessions.length > 0) {
            mObj.generatedSessions = mObj.generatedSessions.map(session => {
                const att = atts.find(a => 
                    a.membershipId?.toString() === m._id.toString() && 
                    a.sessionId?.toString() === session._id.toString()
                );
                
                let attendanceStatus = 'pending'; // Default
                if (att) {
                  attendanceStatus = (att.status === 'present' || att.status === 'late') ? 'present' : 'absent';
                }

                return {
                    ...session,
                    attendanceStatus
                };
            });
        }
        return mObj;
    });

    res.json(finalMemberships);
  } catch (error) {
    console.error('[getMyMemberships] Fatal error:', error.message);
    res.status(500).json({ message: 'Error retrieving memberships', error: error.message });
  }
});

export const getAllMemberships = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const memberships = await Membership.find(filter)
    .populate('userId', 'name email')
    .populate('planId', 'name price validity type classesIncluded durationWeeks billingCycle')
    .sort({ createdAt: -1 });
  res.json(memberships);
});

export const createMembership = asyncHandler(async (req, res) => {
  const {
    planId,
    autoRenew,
    paymentId,
    childId,
    preferredDays,
    preferredSlots: reqPreferredSlots,
    sessionsPerWeek,
    claimBogo,
    bogoChildId,
    couponCode,
    couponAmount,
    discountAmount: reqDiscountAmount,
    membershipUnits: reqUnits,
    startDate: reqStartDate
  } = req.body;

  // FALLBACK (Part 17): Ensure preferredSlots is never empty if days are picked.
  // This prevents memberships from being created with 0 sessions.
  const preferredSlots = (preferredDays?.length > 0 && (!reqPreferredSlots || reqPreferredSlots.length === 0))
    ? ['10:00 AM'] // Default to 10:00 AM if no time picked but days are selected
    : (reqPreferredSlots || []);
  if (!planId) {
    res.status(400);
    throw new Error('planId is required');
  }

  const plan = await Plan.findById(planId);
  if (!plan) {
    res.status(404);
    throw new Error('Plan not found');
  }

  // Handle automatic scaling if not explicitly provided (e.g. from older clients or direct API)
  const totalWeeklySpots = preferredDays.length * (preferredSlots?.length || 1);
  const planCapacity = plan.classesIncluded || 1;
  const membershipUnits = reqUnits || Math.max(1, Math.ceil(totalWeeklySpots / planCapacity));

  // Use provided startDate or default to now
  const startDate = reqStartDate ? new Date(reqStartDate) : new Date();
  
  // Ensure we normalize to start of day for consistency if needed, 
  // though Date(reqStartDate) from an input type="date" usually handles this.
  
  let endDate;

  if (plan.type === 'subscription' && plan.billingCycle && plan.billingCycle !== 'none') {
    if (plan.billingCycle === 'weekly') {
      endDate = addWeeks(startDate, 1);
    } else if (plan.billingCycle === 'monthly') {
      endDate = addMonths(startDate, 1);
    } else if (plan.billingCycle === 'yearly') {
      endDate = addYears(startDate, 1);
    }
  } else if (plan.durationValue && plan.durationUnit) {
    if (plan.durationUnit === 'days') {
      endDate = addDays(startDate, plan.durationValue);
    } else if (plan.durationUnit === 'weeks') {
      endDate = addWeeks(startDate, plan.durationValue);
    } else if (plan.durationUnit === 'months') {
      endDate = addMonths(startDate, plan.durationValue);
    }
  } else if (plan.durationWeeks) {
    endDate = addWeeks(startDate, plan.durationWeeks);
  }

  // -1 = unlimited/time-based (classesIncluded is 0 or null, or explicit type)
  const isInfinite = plan.classesIncluded === 0 || plan.type === 'unlimited' || plan.type === 'time-based';
  
  let baseClasses = plan.classesIncluded ?? (plan.type === 'dropin' ? 1 : 0);
  let classesRemaining = isInfinite ? -1 : baseClasses * membershipUnits;
  
  // Credits initialization
  let creditsRemaining = (plan.type === 'credit-based' && plan.creditsIncluded) 
    ? plan.creditsIncluded * membershipUnits 
    : 0;

  let finalEndDate = endDate;
  let isConsolidatedBogo = false;

  // CONSOLIDATED BOGO PRE-CHECK (Same Child)
  if (paymentId && claimBogo && (String(bogoChildId) === String(childId) || (!bogoChildId && !childId))) {
    if (classesRemaining !== -1) classesRemaining *= 2;
    if (creditsRemaining > 0) creditsRemaining *= 2;

    if (plan.durationValue && plan.durationUnit) {
      if (plan.durationUnit === 'days') {
        finalEndDate = addDays(finalEndDate, plan.durationValue);
      } else if (plan.durationUnit === 'weeks') {
        finalEndDate = addWeeks(finalEndDate, plan.durationValue);
      } else if (plan.durationUnit === 'months') {
        finalEndDate = addMonths(finalEndDate, plan.durationValue);
      }
    } else if (plan.durationWeeks) {
      finalEndDate = addWeeks(finalEndDate, plan.durationWeeks);
    } else if (plan.billingCycle === 'weekly') {
      finalEndDate = addWeeks(finalEndDate, 1);
    } else if (plan.billingCycle === 'monthly') {
      finalEndDate = addMonths(finalEndDate, 1);
    } else if (plan.billingCycle === 'yearly') {
      finalEndDate = addYears(finalEndDate, 1);
    }
    isConsolidatedBogo = true;
  }

  const isStaff = req.user && !['parent', 'customer'].includes((req.user.role || '').toLowerCase());
  const targetUserId = (isStaff && req.body.userId) ? req.body.userId : req.user._id;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [primaryMembership] = await Membership.create([{
      userId: targetUserId,
      planId,
      startDate,
      endDate: finalEndDate,
      autoRenew: Boolean(autoRenew),
      classesRemaining,
      creditsRemaining,
      childId,
      preferredDays,
      preferredSlots,
      sessionsPerWeek,
      paymentId,
      locationId: plan.locationId || resolveReadLocationId(req),
      membershipUnits
    }], { session });

    if (preferredDays && preferredSlots && preferredDays.length > 0) {
      const sessionIds = await generateMembershipSessions(primaryMembership, plan, session);
      primaryMembership.generatedSessions = sessionIds;
      await primaryMembership.save({ session });
    }

    let payRec = null;
    if (paymentId && mongoose.Types.ObjectId.isValid(paymentId)) {
        payRec = await Payment.findById(paymentId).session(session);
    }

    let resolvedPaymentMethod = payRec ? payRec.paymentMethod : 'center';
    let promotionId = payRec ? payRec.promotionId : null;
    const discountAmount = Number(payRec?.discountAmount ?? reqDiscountAmount ?? 0) || 0;
    const resolvedCouponAmount = Number(couponAmount ?? payRec?.couponAmount ?? 0) || 0;
    const resolvedCouponCodeRaw = (couponCode ?? payRec?.couponCode ?? '').toString().trim();
    const resolvedCouponCode = resolvedCouponCodeRaw ? resolvedCouponCodeRaw.toUpperCase() : undefined;

    const primaryChild = await Child.findById(childId).session(session);
    const participants = [];
    
    if (primaryChild) {
      participants.push({
        name: primaryChild.name,
        age: primaryChild.age,
        gender: primaryChild.gender,
        relation: 'Child',
        childId: primaryChild._id
      });
    } else {
      participants.push({
        name: req.user.name || 'Account Holder',
        age: 18,
        gender: 'other',
        relation: 'Self'
      });
    }

    let bogoMembershipId = null;
    if (claimBogo && !isConsolidatedBogo) {
       const finalBogoChildId = bogoChildId || childId;
       const bogoChild = await Child.findById(finalBogoChildId).session(session);
       
       const [freeMembership] = await Membership.create([{
          userId: targetUserId,
          planId,
          startDate,
          endDate,
          autoRenew: false,
          classesRemaining: plan.classesIncluded ?? (plan.type === 'dropin' ? 1 : undefined),
          childId: finalBogoChildId,
          preferredDays,
          preferredSlots,
          sessionsPerWeek,
          paymentId,
          locationId: plan.locationId,
          isBogoFree: true
       }], { session });

       bogoMembershipId = freeMembership._id;

       if (preferredDays && preferredSlots && preferredDays.length > 0) {
          const freeSessionIds = await generateMembershipSessions(freeMembership, plan, session);
          freeMembership.generatedSessions = freeSessionIds;
          await freeMembership.save({ session });
       }

       if (bogoChild) {
          participants.push({
             name: bogoChild.name,
             age: bogoChild.age,
             gender: bogoChild.gender,
             relation: 'Child',
             childId: bogoChild._id
          });
       }
    }

    const bookingNumber = await getNextBookingNumber();

    // TAX & PRICE CALCULATION
    const rawBaseAmount = plan.price * membershipUnits;
    const netBaseAmount = Math.max(0, rawBaseAmount - discountAmount - resolvedCouponAmount);

    let taxAmount = 0;
    let activeTax = null;
    if (plan.taxId) {
       activeTax = await Tax.findById(plan.taxId);
    } else if (plan.locationId) {
       activeTax = await Tax.findOne({ 
          locationId: plan.locationId, 
          status: 'active',
          $or: [
            { validityEnd: { $exists: false } },
            { validityEnd: { $gte: new Date() } }
          ]
       });
    }

    if (activeTax) {
       taxAmount = calculateTax(netBaseAmount, activeTax);
    }

    const totalAmount = (activeTax?.calculationMethod === 'inclusive') ? netBaseAmount : (netBaseAmount + taxAmount);

    // Keep payment snapshot in sync with the finalized payable amount from booking logic.
    if (payRec) {
      payRec.userId = targetUserId;
      payRec.amount = totalAmount;
      payRec.promotionId = promotionId;
      payRec.discountAmount = discountAmount;
      payRec.couponCode = resolvedCouponCode;
      payRec.couponAmount = resolvedCouponAmount;
      payRec.membershipUnits = membershipUnits;
      await payRec.save({ session });
    }

    const [bookingRec] = await Booking.create([{
      userId: targetUserId,
      bookingNumber,
      bookingType: 'package',
      planId: plan._id,
      date: startDate,
      totalAmount,
      taxAmount,
      taxId: activeTax?._id,
      status: resolvedPaymentMethod === 'center' ? 'pending' : 'confirmed',
      paymentStatus: resolvedPaymentMethod === 'center' ? 'pending' : 'completed',
      paymentMethod: resolvedPaymentMethod,
      paymentId: paymentId,
      locationId: plan.locationId,
      promotionId,
      discountAmount,
      couponCode: resolvedCouponCode,
      couponAmount: resolvedCouponAmount,
      participants
    }], { session });

    primaryMembership.bookingId = bookingRec._id;
    await primaryMembership.save({ session });

    if (bogoMembershipId) {
       await Membership.findByIdAndUpdate(bogoMembershipId, { bookingId: bookingRec._id }, { session });
    }

    const invoiceNumber = await getNextInvoiceNumber();
    const invoiceItems = [{
       description: `${plan.name} - Package Enrollment`,
       quantity: membershipUnits,
       unitPrice: plan.price,
       taxAmount: (activeTax && !isConsolidatedBogo) ? (taxAmount / membershipUnits) : 0,
       total: plan.price * membershipUnits
    }];

    if (claimBogo && !isConsolidatedBogo) {
       invoiceItems.push({
          description: `BOGO Promo - Free Item`,
          quantity: membershipUnits,
          unitPrice: 0,
          total: 0
       });
    }

    if (discountAmount > 0) {
       invoiceItems.push({
          description: `Promotion Discount`,
          quantity: 1,
          unitPrice: -discountAmount,
          total: -discountAmount
       });
    }

    if (resolvedCouponAmount > 0) {
       invoiceItems.push({
          description: resolvedCouponCode ? `Cash Voucher Applied (${resolvedCouponCode})` : 'Cash Voucher Applied',
          quantity: 1,
          unitPrice: -resolvedCouponAmount,
          total: -resolvedCouponAmount
       });
    }

    await Invoice.create([{
       invoiceNumber,
       bookingId: bookingRec._id,
       userId: targetUserId,
       amount: totalAmount,
       grossAmount: plan.price * membershipUnits,
       totalAmount: totalAmount,
       taxAmount: taxAmount,
       status: resolvedPaymentMethod === 'center' ? 'unpaid' : 'paid',
       items: invoiceItems,
       locationId: plan.locationId,
       discountAmount: discountAmount || 0,
       couponAmount: resolvedCouponAmount || 0,
       couponCode: resolvedCouponCode
    }], { session });
    
    // COUPON GENERATION LOGIC (Cash Deposit Promo)
    if (promotionId) {
       const promo = await Promotion.findById(promotionId).session(session);
       if (promo && promo.promoType === 'cash_deposit') {
          const couponValue = (promo.discountType === 'percentage') 
             ? (plan.price * (promo.discountValue / 100))
             : Math.min(plan.price, promo.discountValue);
          
          if (couponValue > 0) {
             const generatedCode = `CPN-M-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
             const expiryDate = new Date();
             expiryDate.setDate(expiryDate.getDate() + 90);

             await Coupon.create([{
                code: generatedCode,
                userId: targetUserId,
                amount: Math.round(couponValue * 100) / 100,
                expiryDate,
                sourceBookingId: bookingRec._id,
                status: 'active'
             }], { session });
          }
       }
    }

    // COUPON REDEMPTION LOGIC
    if (resolvedCouponCode) {
       const redeemedCoupon = await Coupon.findOne({ code: resolvedCouponCode, status: 'active' }).session(session);
       if (redeemedCoupon) {
          redeemedCoupon.status = 'redeemed';
          redeemedCoupon.redeemBookingId = bookingRec._id;
          redeemedCoupon.redeemedAt = new Date();
          // Assign user if it was an anonymous voucher
          if (!redeemedCoupon.userId) {
             redeemedCoupon.userId = targetUserId;
          }
          await redeemedCoupon.save({ session });
       }
    }

    await session.commitTransaction();

    const final = await Membership.findById(primaryMembership._id)
      .populate('userId', 'name email firstName lastName')
      .populate('planId')
      .populate('childId')
      .populate({ path: 'bookingId', select: 'participants bookingNumber' })
      .populate({ path: 'generatedSessions', populate: { path: 'trainerId', select: 'name' } });

    res.status(201).json(final);
  } catch (err) {
    if (session.inTransaction()) {
        await session.abortTransaction();
    }
    console.error('[Transaction Abort] Internal Error:', err.message);
    res.status(500).json({ 
        message: 'Sync failed: ' + (err.message || 'Internal logic error'), 
        details: 'Payment recorded (' + paymentId + ') but membership could not be finalized. Please contact support.',
        paymentId 
    });
  } finally {
    session.endSession();
  }
});

export const updateMembership = asyncHandler(async (req, res) => {
  const membership = await Membership.findById(req.params.id);
  if (!membership) {
    res.status(404);
    throw new Error('Membership not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && membership.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  Object.assign(membership, req.body);
  const saved = await membership.save();

  const userData = await User.findById(saved.userId);
  const planData = await Plan.findById(saved.planId);
  if (userData && planData) {
    sendMembershipUpdateEmail(saved, userData, planData).catch(err => console.error('Membership update email failed:', err.message));
  }

  res.json(saved);
});

export const getMembershipByBookingId = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;

  const membership = await Membership.findOne({ bookingId })
    .populate('planId', 'name price validity type classesIncluded durationWeeks')
    .populate({
      path: 'generatedSessions',
      populate: { path: 'trainerId', select: 'name' },
      options: { sort: { startTime: 1 } }
    });

  if (!membership) {
    res.status(404);
    throw new Error('Membership not found for this booking');
  }

  // Check location access if admin
  if (req.user?.role === 'admin' && req.user.locationId && membership.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Access denied to this membership');
  }

  res.json(membership);
});

// @desc    Toggle Membership Freeze
// @route   POST /api/memberships/:id/freeze
// @access  Private
export const toggleFreeze = asyncHandler(async (req, res) => {
  const membership = await Membership.findById(req.params.id).populate('planId');
  if (!membership) {
    res.status(404);
    throw new Error('Membership not found');
  }

  // Permission: Admin or the student
  const isOwner = membership.userId.toString() === req.user._id.toString();
  const isAdmin = ['admin', 'superadmin', 'manager'].includes(req.user.role || '');
  if (!isOwner && !isAdmin) {
    res.status(403);
    throw new Error('Not allowed to freeze this membership');
  }

  const { reason } = req.body;

  if (membership.status === 'active') {
    // FREEZE
    if (membership.planId && !membership.planId.extensionRules?.allowFreezing && !isAdmin) {
       res.status(400);
       throw new Error('Your plan does not allow freezing. Please contact center.');
    }

    membership.status = 'frozen';
    membership.freezeHistory.push({
      startDate: new Date(),
      reason: reason || 'User requested pause',
      processedBy: req.user._id
    });
    
    await membership.save();
    return res.json({ message: 'Membership frozen successfully', status: 'frozen' });
  } else if (membership.status === 'frozen') {
    // UNFREEZE
    const lastFreeze = membership.freezeHistory[membership.freezeHistory.length - 1];
    if (lastFreeze && !lastFreeze.endDate) {
       lastFreeze.endDate = new Date();
       
       // Calculate Duration and extend membership end date
       const diffTime = Math.abs(lastFreeze.endDate - lastFreeze.startDate);
       const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
       
       if (diffDays > 0) {
          const oldEnd = new Date(membership.endDate);
          membership.endDate = new Date(oldEnd.setDate(oldEnd.getDate() + diffDays));
          membership.previousEndDate = oldEnd;
       }
    }

    membership.status = 'active';
    await membership.save();
    return res.json({ message: 'Membership unfrozen successfully. End date extended.', status: 'active', newEndDate: membership.endDate });
  } else {
    res.status(400);
    throw new Error('Only active or frozen memberships can be toggled.');
  }
});
