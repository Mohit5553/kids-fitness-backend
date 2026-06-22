import express from 'express';
import {
  openShift,
  closeShift,
  getCurrentShift,
  getCurrentShiftTotals,
  getAllShifts
} from '../controllers/shiftController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/open', protect, openShift);
router.post('/close', protect, closeShift);
router.get('/current', protect, getCurrentShift);
router.get('/current/totals', protect, getCurrentShiftTotals);
router.get('/', protect, adminOnly, getAllShifts);

export default router;
