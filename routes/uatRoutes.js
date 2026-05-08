import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { clearUATTransactions, promoteToLive, getUATConfigs, discardUATConfig, syncOldData } from '../controllers/uatController.js';

const router = express.Router();

// All UAT tools are restricted to Superadmins
router.use(protect);
router.use(adminOnly);

router.delete('/clear-transactions', clearUATTransactions);
router.delete('/discard', discardUATConfig);
router.post('/promote', promoteToLive);
router.post('/sync-old-data', syncOldData);
router.get('/configs', getUATConfigs);

export default router;
