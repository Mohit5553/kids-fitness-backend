import express from 'express';
import {
  getSessions,
  getSessionById,
  createSession,
  updateSession,
  deleteSession,
  getSessionQr
} from '../controllers/sessionController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getSessions);
router.get('/:id', getSessionById);
router.post('/', protect, adminOnly, createSession);
router.put('/:id', protect, adminOnly, updateSession);
router.delete('/:id', protect, adminOnly, deleteSession);
router.get('/:id/qr', protect, adminOnly, getSessionQr);

export default router;
