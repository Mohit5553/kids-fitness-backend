import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getInvoices,
  getInvoiceById,
  getMyInvoices,
  updateInvoiceStatus,
  getInvoiceByBookingId
} from '../controllers/invoiceController.js';

const router = express.Router();

router.get('/', protect, adminOnly, getInvoices);
router.get('/mine', protect, getMyInvoices);
router.get('/booking/:bookingId', protect, getInvoiceByBookingId);
router.get('/:id', protect, getInvoiceById);
router.put('/:id', protect, adminOnly, updateInvoiceStatus);

export default router;
