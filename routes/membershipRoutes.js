import express from 'express';
import { getMyMemberships, getAllMemberships, createMembership, updateMembership } from '../controllers/membershipController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/mine', protect, getMyMemberships);
router.get('/', protect, adminOnly, getAllMemberships);
router.post('/', protect, createMembership);
router.put('/:id', protect, adminOnly, updateMembership);

export default router;
