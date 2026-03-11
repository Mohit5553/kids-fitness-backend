import express from 'express';
import { getMyAttendance, getAllAttendance, checkIn, qrCheckIn } from '../controllers/attendanceController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/mine', protect, getMyAttendance);
router.get('/', protect, adminOnly, getAllAttendance);
router.post('/checkin', protect, adminOnly, checkIn);
router.post('/qr-checkin', qrCheckIn);

export default router;
