import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getMyCoupons,
  getAllCoupons,
  validateCoupon,
  createCoupon,
  deleteCoupon,
  deleteCouponBatch
} from '../controllers/couponController.js';

const router = express.Router();

router.use(protect);

router.get('/mine', getMyCoupons);
router.post('/validate', validateCoupon);

// Admin routes
router.get('/', adminOnly, getAllCoupons);
router.post('/', adminOnly, createCoupon);
router.delete('/batch/:batchId', adminOnly, deleteCouponBatch);
router.delete('/:id', adminOnly, deleteCoupon);

export default router;
