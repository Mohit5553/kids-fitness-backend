import express from 'express';
import { getCounters, updateCounter, getGlobalSettings, updateGlobalSetting } from '../controllers/settingController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/counters').get(protect, adminOnly, getCounters);
router.route('/counters/:name').put(protect, adminOnly, updateCounter);

router.route('/global').get(getGlobalSettings); // Publicly readable for checkout logic
router.route('/global/:key').put(protect, adminOnly, updateGlobalSetting);

export default router;
