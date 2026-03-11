import express from 'express';
import { createTrial, getTrials, updateTrialStatus, exportTrialsCsv } from '../controllers/trialController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', createTrial);
router.get('/', protect, adminOnly, getTrials);
router.put('/:id/status', protect, adminOnly, updateTrialStatus);
router.get('/export/csv', protect, adminOnly, exportTrialsCsv);

export default router;
