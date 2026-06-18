import express from 'express';
import {
  openShift,
  closeShift,
  getCurrentShift,
  getAllShifts
} from '../controllers/shiftController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/open', protect, openShift);
router.post('/close', protect, closeShift);
router.get('/current', protect, getCurrentShift);
router.get('/', protect, adminOnly, getAllShifts);

export default router;
