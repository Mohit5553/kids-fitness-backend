import express from 'express';
import {
  getClasses,
  getClassById,
  createClass,
  updateClass,
  deleteClass
} from '../controllers/classController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getClasses);
router.get('/:id', getClassById);
router.post('/', protect, adminOnly, createClass);
router.put('/:id', protect, adminOnly, updateClass);
router.delete('/:id', protect, adminOnly, deleteClass);

export default router;
