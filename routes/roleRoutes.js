import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getRoles,
  createRole,
  updateRole,
  deleteRole
} from '../controllers/roleController.js';

const router = express.Router();

router.use(protect);
router.use(adminOnly);

router.route('/')
  .get(getRoles)
  .post(createRole);

router.route('/:id')
  .put(updateRole)
  .delete(deleteRole);

export default router;
