import express from 'express';
import {
  getSessions,
  getSessionById,
  createSession,
  updateSession,
  deleteSession,
  getSessionQr,
  bulkCreateSessions
} from '../controllers/sessionController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getSessions);
router.get('/:id', getSessionById);
router.post('/', protect, adminOnly, createSession);
router.put('/:id', protect, adminOnly, updateSession);
router.delete('/:id', protect, adminOnly, deleteSession);
router.post('/bulk', protect, adminOnly, bulkCreateSessions);
router.get('/:id/qr', protect, adminOnly, getSessionQr);

export default router;
