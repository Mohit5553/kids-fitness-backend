import express from 'express';
import {
  getSessions,
  getSessionById,
  createSession,
  updateSession,
  deleteSession,
  getSessionQr,
  bulkCreateSessions,
  updateTrainerStatus
} from '../controllers/sessionController.js';
import { protect, adminOnly, optionalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', optionalAuth, getSessions);
router.get('/:id', optionalAuth, getSessionById);
router.post('/', protect, adminOnly, createSession);
router.put('/:id', protect, adminOnly, updateSession);
router.put('/:id/trainer-status', protect, updateTrainerStatus);
router.delete('/:id', protect, deleteSession);
router.post('/bulk', protect, adminOnly, bulkCreateSessions);
router.get('/:id/qr', protect, adminOnly, getSessionQr);

export default router;
