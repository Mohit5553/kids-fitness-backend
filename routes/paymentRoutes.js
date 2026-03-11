import express from 'express';
import { getMyPayments, getAllPayments, createPayment, createBookingPayment, exportPaymentsCsv } from '../controllers/paymentController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/mine', protect, getMyPayments);
router.get('/', protect, adminOnly, getAllPayments);
router.get('/export/csv', protect, adminOnly, exportPaymentsCsv);
router.post('/', protect, createPayment);
router.post('/booking', protect, createBookingPayment);

export default router;
