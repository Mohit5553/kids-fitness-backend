import Shift from '../models/Shift.js';
import Payment from '../models/Payment.js';

// @desc    Open a new shift
// @route   POST /api/shifts/open
// @access  Private (Cashier/Admin)
export const openShift = async (req, res, next) => {
  try {
    const { startingCash, locationId } = req.body;

    // Check if user already has an open shift
    const existingShift = await Shift.findOne({ cashierId: req.user._id, status: 'open' });
    if (existingShift) {
      return res.status(400).json({ message: 'You already have an open shift. Please close it first.' });
    }

    const shift = await Shift.create({
      cashierId: req.user._id,
      locationId: locationId || req.user.locationId,
      status: 'open',
      openedAt: new Date(),
      startingCash: Number(startingCash) || 0
    });

    res.status(201).json(shift);
  } catch (error) {
    next(error);
  }
};

// @desc    Get the current open shift for the user
// @route   GET /api/shifts/current
// @access  Private
export const getCurrentShift = async (req, res, next) => {
  try {
    const shift = await Shift.findOne({ cashierId: req.user._id, status: 'open' });
    res.json(shift || null);
  } catch (error) {
    next(error);
  }
};

// @desc    Close the current shift
// @route   POST /api/shifts/close
// @access  Private
export const closeShift = async (req, res, next) => {
  try {
    const { actualCash, notes } = req.body;

    const shift = await Shift.findOne({ cashierId: req.user._id, status: 'open' });
    if (!shift) {
      return res.status(400).json({ message: 'No open shift found to close.' });
    }

    const closedAt = new Date();

    // Query all payments processed by this cashier during this shift
    const payments = await Payment.find({
      processedBy: req.user._id,
      createdAt: { $gte: shift.openedAt, $lte: closedAt }
    });

    // Calculate expected totals based on paymentMethod
    let expectedCash = 0;
    let expectedCard = 0;
    let expectedOnline = 0;

    payments.forEach(payment => {
      const amount = payment.amount || 0;
      if (payment.paymentMethod === 'cash') {
        expectedCash += amount;
      } else if (payment.paymentMethod === 'card' || payment.paymentMethod === 'terminal') {
        expectedCard += amount;
      } else {
        expectedOnline += amount;
      }
    });

    // Calculate discrepancy (Starting Cash + Payments in Cash - Actual Cash Counted)
    const totalExpectedCashInDrawer = shift.startingCash + expectedCash;
    const discrepancy = Number(actualCash) - totalExpectedCashInDrawer;

    shift.closedAt = closedAt;
    shift.status = 'closed';
    shift.expectedCash = expectedCash;
    shift.expectedCard = expectedCard;
    shift.expectedOnline = expectedOnline;
    shift.actualCash = Number(actualCash);
    shift.discrepancy = discrepancy;
    if (notes) shift.notes = notes;

    await shift.save();

    res.json(shift);
  } catch (error) {
    next(error);
  }
};

// @desc    Get all shifts (Admin)
// @route   GET /api/shifts
// @access  Private/Admin
export const getAllShifts = async (req, res, next) => {
  try {
    const shifts = await Shift.find({})
      .populate('cashierId', 'name email role')
      .populate('locationId', 'name')
      .sort({ openedAt: -1 });

    res.json(shifts);
  } catch (error) {
    next(error);
  }
};
