import express from 'express';
import { getUsers, getUserById, updateUser, deleteUser, createStaff, getUserChildren, lookupUser, createWalkingCustomer, suggestUsers } from '../controllers/userController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/')
  .get(protect, adminOnly, getUsers)
  .post(protect, adminOnly, createStaff);

router.get('/lookup', protect, adminOnly, lookupUser);
router.get('/suggest', protect, adminOnly, suggestUsers);
router.post('/walking', protect, adminOnly, createWalkingCustomer);

router.route('/:id')
  .get(protect, adminOnly, getUserById)
  .put(protect, adminOnly, updateUser)
  .delete(protect, adminOnly, deleteUser);

router.get('/:id/children', protect, adminOnly, getUserChildren);

export default router;
