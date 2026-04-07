import express from 'express';
import { getCounters, updateCounter } from '../controllers/settingController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/counters').get(protect, adminOnly, getCounters);
router.route('/counters/:name').put(protect, adminOnly, updateCounter);

export default router;
