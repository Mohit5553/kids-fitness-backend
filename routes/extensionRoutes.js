import express from 'express';
import { requestExtension, processExtension, getMyExtensions, getAllExtensions } from '../controllers/extensionController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, adminOnly, getAllExtensions);
router.get('/my', protect, getMyExtensions);
router.post('/request', protect, requestExtension);
router.post('/:id/process', protect, adminOnly, processExtension);

export default router;
