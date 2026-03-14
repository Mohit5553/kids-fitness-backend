import express from 'express';
import {
  getMyBookings,
  getAllBookings,
  createBooking,
  updateBookingStatus,
  deleteBooking
} from '../controllers/bookingController.js';
import { protect, adminOnly, optionalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/mine', protect, getMyBookings);
router.get('/', protect, adminOnly, getAllBookings);
router.post('/', optionalAuth, createBooking);
router.put('/:id/status', protect, adminOnly, updateBookingStatus);
router.delete('/:id', protect, deleteBooking);

export default router;
