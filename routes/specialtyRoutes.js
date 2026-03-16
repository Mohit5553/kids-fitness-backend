import express from 'express';
import {
  getSpecialties,
  createSpecialty,
  updateSpecialty,
  deleteSpecialty
} from '../controllers/specialtyController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getSpecialties);
router.post('/', protect, adminOnly, createSpecialty);
router.put('/:id', protect, adminOnly, updateSpecialty);
router.delete('/:id', protect, adminOnly, deleteSpecialty);

export default router;
