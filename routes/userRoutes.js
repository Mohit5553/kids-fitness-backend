import express from 'express';
import { getUsers, getUserById, updateUserRole, deleteUser, createStaff, getUserChildren } from '../controllers/userController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/')
  .get(protect, adminOnly, getUsers)
  .post(protect, adminOnly, createStaff);

router.route('/:id')
  .get(protect, adminOnly, getUserById)
  .put(protect, adminOnly, updateUserRole)
  .delete(protect, adminOnly, deleteUser);

router.get('/:id/children', protect, adminOnly, getUserChildren);

export default router;
