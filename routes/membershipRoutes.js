import express from 'express';
import { getMyMemberships, getAllMemberships, createMembership, updateMembership, getMembershipByBookingId, toggleFreeze, updateMembershipTrainer } from '../controllers/membershipController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/mine', protect, getMyMemberships);
router.get('/', protect, adminOnly, getAllMemberships);
router.get('/booking/:bookingId', protect, getMembershipByBookingId);
router.post('/', protect, createMembership);
router.put('/:id', protect, adminOnly, updateMembership);
router.put('/:id/trainer', protect, adminOnly, updateMembershipTrainer);
router.post('/:id/freeze', protect, toggleFreeze);

export default router;
