import express from 'express';
import { getSummary } from '../controllers/reportController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/summary', protect, adminOnly, getSummary);

export default router;
