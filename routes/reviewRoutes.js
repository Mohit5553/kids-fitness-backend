import express from 'express';
import {
  createReview,
  getReviewsByTarget,
  getMyReviews,
  getAdminReviews,
  deleteReview
} from '../controllers/reviewController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/')
  .post(protect, createReview)
  .get(protect, adminOnly, getAdminReviews);

router.get('/my', protect, getMyReviews);
router.get('/target/:targetType/:targetId', getReviewsByTarget);

router.route('/:id')
  .delete(protect, adminOnly, deleteReview);

export default router;
