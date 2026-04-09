import express from 'express';
const router = express.Router();
import {
  getPromotions,
  getActivePromotions,
  createPromotion,
  updatePromotion,
  deletePromotion
} from '../controllers/promotionController.js';
import { protect, staffOnly } from '../middleware/authMiddleware.js';

router.route('/')
  .get(protect, staffOnly, getPromotions)
  .post(protect, staffOnly, createPromotion);

router.get('/active', getActivePromotions);

router.route('/:id')
  .put(protect, staffOnly, updatePromotion)
  .delete(protect, staffOnly, deletePromotion);

export default router;
