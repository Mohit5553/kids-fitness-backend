import express from 'express';
import {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense
} from '../controllers/expenseController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);
router.use(adminOnly);

router.route('/')
  .get(getExpenses)
  .post(createExpense);

router.route('/:id')
  .put(updateExpense)
  .delete(deleteExpense);

export default router;
