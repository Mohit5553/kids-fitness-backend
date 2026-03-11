import express from 'express';
import {
  getMyChildren,
  getAllChildren,
  createChild,
  updateChild,
  deleteChild
} from '../controllers/childController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/mine', protect, getMyChildren);
router.get('/', protect, adminOnly, getAllChildren);
router.post('/', protect, createChild);
router.put('/:id', protect, updateChild);
router.delete('/:id', protect, deleteChild);

export default router;
