import asyncHandler from 'express-async-handler';
import Coupon from '../models/Coupon.js';

// @desc    Get my active coupons
// @route   GET /api/coupons/mine
// @access  Private
export const getMyCoupons = asyncHandler(async (req, res) => {
  const now = new Date();
  const coupons = await Coupon.find({
    userId: req.user._id,
    status: 'active',
    expiryDate: { $gt: now }
  }).sort({ createdAt: -1 });

  res.json(coupons);
});

// @desc    Get all coupons (Admin)
// @route   GET /api/coupons
// @access  Private/Admin
export const getAllCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find({})
    .populate('userId', 'name email')
    .sort({ createdAt: -1 });
  res.json(coupons);
});

// @desc    Validate a coupon code
// @route   POST /api/coupons/validate
// @access  Private
export const validateCoupon = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) {
    res.status(400);
    throw new Error('Coupon code is required');
  }

  const coupon = await Coupon.findOne({
    code: code.toUpperCase(),
    status: 'active'
  });

  if (!coupon) {
    res.status(404);
    throw new Error('Invalid or used coupon');
  }

  // Check expiry
  if (new Date() > coupon.expiryDate) {
    coupon.status = 'expired';
    await coupon.save();
    res.status(400);
    throw new Error('Coupon has expired');
  }

  // Ownership check
  if (coupon.userId && coupon.userId.toString() !== req.user._id.toString()) {
    // If staff is processing, it's allowed.
    const isStaff = req.user.role !== 'parent' && req.user.role !== 'customer';
    if (!isStaff) {
      res.status(403);
      throw new Error('This coupon belongs to another user');
    }
  }

  res.json({
    success: true,
    data: {
      code: coupon.code,
      amount: coupon.amount,
      _id: coupon._id
    }
  });
});

// @desc    Create a new coupon (Admin)
// @route   POST /api/coupons
// @access  Private/Admin
export const createCoupon = asyncHandler(async (req, res) => {
  const { code, amount, expiryDate, userId, type, description, count = 1 } = req.body;

  if (count > 1) {
    // Batch generation
    const batchId = `BATCH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const bName = description || `Batch of ${count} Vouchers`;
    const coupons = [];
    for (let i = 0; i < count; i++) {
      const generatedCode = code ? `${code}-${i + 1}` : `GIFT-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      coupons.push({
        code: generatedCode,
        amount,
        expiryDate,
        userId: userId || undefined,
        type: type || 'gift',
        description,
        batchId,
        batchName: bName
      });
    }
    const created = await Coupon.insertMany(coupons);
    return res.status(201).json(created);
  }

  // Single creation
  if (!amount || !expiryDate) {
    res.status(400);
    throw new Error('Amount and expiry date are required');
  }

  const finalCode = code || `GIFT-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

  const exists = await Coupon.findOne({ code: finalCode.toUpperCase() });
  if (exists) {
    res.status(400);
    throw new Error('Coupon code already exists');
  }

  const coupon = await Coupon.create({
    code: finalCode,
    amount,
    expiryDate,
    userId: userId || undefined,
    type: type || 'gift',
    description
  });

  res.status(201).json(coupon);
});

// @desc    Delete/Revoke a batch of coupons (Admin)
// @route   DELETE /api/coupons/batch/:batchId
// @access  Private/Admin
export const deleteCouponBatch = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  if (!batchId) {
    res.status(400);
    throw new Error('Batch ID is required');
  }

  const result = await Coupon.deleteMany({ batchId });
  res.json({ message: `${result.deletedCount} vouchers revoked from batch` });
});

// @desc    Delete/Revoke a coupon (Admin)
// @route   DELETE /api/coupons/:id
// @access  Private/Admin
export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) {
    res.status(404);
    throw new Error('Coupon not found');
  }

  await coupon.deleteOne();
  res.json({ message: 'Coupon revoked' });
});
