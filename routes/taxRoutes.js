import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  createTax,
  getTaxes,
  getTaxById,
  updateTax,
  deleteTax,
} from '../controllers/taxController.js';

const router = express.Router();

router.use(protect);

router
  .route('/')
  .post(adminOnly, createTax)
  .get(getTaxes);

router
  .route('/:id')
  .get(getTaxById)
  .patch(adminOnly, updateTax)
  .delete(adminOnly, deleteTax);

export default router;
