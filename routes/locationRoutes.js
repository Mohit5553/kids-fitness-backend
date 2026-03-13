import express from 'express';
import {
  getLocations,
  getLocationById,
  createLocation,
  updateLocation,
  deleteLocation,
  getMyLocation
} from '../controllers/locationController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getLocations);
router.get('/me', protect, getMyLocation);
router.get('/:id', getLocationById);
router.post('/', protect, adminOnly, createLocation);
router.put('/:id', protect, adminOnly, updateLocation);
router.delete('/:id', protect, adminOnly, deleteLocation);

export default router;
