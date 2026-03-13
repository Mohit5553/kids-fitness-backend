import express from 'express';
import {
  getActivities,
  getActivityById,
  createActivity,
  updateActivity,
  deleteActivity
} from '../controllers/activityController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getActivities);
router.get('/:id', getActivityById);
router.post('/', protect, adminOnly, createActivity);
router.put('/:id', protect, adminOnly, updateActivity);
router.delete('/:id', protect, adminOnly, deleteActivity);

export default router;
