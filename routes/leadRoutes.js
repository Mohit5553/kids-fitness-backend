import express from 'express';
import { createLead, getLeads, updateLeadStatus, deleteLead } from '../controllers/leadController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', createLead);
router.get('/', protect, adminOnly, getLeads);
router.put('/:id/status', protect, adminOnly, updateLeadStatus);
router.delete('/:id', protect, adminOnly, deleteLead);

export default router;
