import asyncHandler from 'express-async-handler';
import Promotion from '../models/Promotion.js';
import { resolveReadLocationIds } from '../utils/locationScope.js';

// @desc    Get all promotions
// @route   GET /api/promotions
// @access  Private/Admin
export const getPromotions = asyncHandler(async (req, res) => {
  const locationIds = resolveReadLocationIds(req);
  const filter = locationIds ? { applicableLocations: { $in: locationIds } } : {};
  
  const promotions = await Promotion.find(filter)
    .populate('applicableLocations', 'name')
    .populate('applicableClasses', 'title')
    .populate('applicablePlans', 'name')
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 });
    
  res.json(promotions);
});

// @desc    Get active promotions for a specific context
// @route   GET /api/promotions/active
// @access  Public
export const getActivePromotions = asyncHandler(async (req, res) => {
  const { locationId, itemId, itemType } = req.query;
  const now = new Date();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  
  const filter = {
    isActive: true,
    startDate: { $lte: endOfDay },
    endDate: { $gte: startOfDay }
  };

  if (locationId) {
    filter.applicableLocations = locationId;
  }

  const promos = await Promotion.find(filter).lean();
  
  // Filter by item if provided
  const applicable = promos.filter(p => {
    // If promo is item-specific
    const hasItemConstraint = (p.applicableClasses && p.applicableClasses.length > 0) || 
                             (p.applicablePlans && p.applicablePlans.length > 0);
    
    if (!hasItemConstraint) return true;

    if (itemType === 'class' && p.applicableClasses?.some(id => id.toString() === itemId)) return true;
    if (itemType === 'plan' && p.applicablePlans?.some(id => id.toString() === itemId)) return true;
    
    return false;
  });

  res.json(applicable);
});

// @desc    Create a promotion
// @route   POST /api/promotions
// @access  Private/Admin
export const createPromotion = asyncHandler(async (req, res) => {
  const promotion = await Promotion.create({
    ...req.body,
    createdBy: req.user._id
  });
  res.status(201).json(promotion);
});

// @desc    Update a promotion
// @route   PUT /api/promotions/:id
// @access  Private/Admin
export const updatePromotion = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) {
    res.status(404);
    throw new Error('Promotion not found');
  }

  const updated = await Promotion.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(updated);
});

// @desc    Delete a promotion
// @route   DELETE /api/promotions/:id
// @access  Private/Admin
export const deletePromotion = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) {
    res.status(404);
    throw new Error('Promotion not found');
  }

  await promotion.deleteOne();
  res.json({ message: 'Promotion removed' });
});

/**
 * Internal utility to calculate discount
 */
export const calculateDiscount = (promotion, orderDetails) => {
  const { amount, quantity = 1, itemType, itemId } = orderDetails;
  let discountAmount = 0;

  switch (promotion.promoType) {
    case 'percentage':
      discountAmount = (amount * (promotion.discountValue / 100));
      break;
    case 'cash':
      discountAmount = Math.min(amount, promotion.discountValue);
      break;
    case 'flash':
      // Flash sales usually act like percentage/cash but time-gated
      if (promotion.discountType === 'percentage') {
        discountAmount = (amount * (promotion.discountValue / 100));
      } else {
        discountAmount = Math.min(amount, promotion.discountValue);
      }
      break;
    case 'tiered':
      // Ticket level promotion
      const tier = promotion.discountTiers
        .filter(t => amount >= t.minAmount && (!t.maxAmount || amount <= t.maxAmount))
        .sort((a, b) => b.minAmount - a.minAmount)[0]; // Get highest applicable tier
      
      if (tier) {
        if (tier.type === 'percentage') {
          discountAmount = (amount * (tier.value / 100));
        } else {
          discountAmount = Math.min(amount, tier.value);
        }
      }
      break;
    case 'bogo':
      // BOGO logic: If buying 1, get 1 free means essentially 100% off the second item
      // In a single purchase context, it's often represented as 50% off if buying 2
      // But user said "Buy 1 get 1 another classes membership free"
      // This implies cross-item. If both are in the "cart", the cheaper or specific one is free.
      // For now, let's treat it as a fixed discount if criteria met.
      discountAmount = amount; // Simple implementation: specified "Get" item is free
      break;
    case 'bulk':
      if (quantity >= promotion.minQuantity) {
        if (promotion.discountType === 'percentage') {
          discountAmount = (amount * (promotion.discountValue / 100));
        } else {
          discountAmount = Math.min(amount, promotion.discountValue);
        }
      }
      break;
    case 'lifestyle':
      // Verified lifestyle (targeted group)
      if (promotion.discountType === 'percentage') {
        discountAmount = (amount * (promotion.discountValue / 100));
      } else {
        discountAmount = Math.min(amount, promotion.discountValue);
      }
      break;
  }

  return Math.round(discountAmount * 100) / 100;
};
