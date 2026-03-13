import express from 'express';
import { getSummary, getParentSummary } from '../controllers/reportController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/summary', protect, adminOnly, getSummary);
router.get('/parent-summary', protect, getParentSummary);

export default router;
