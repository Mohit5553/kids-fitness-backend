import express from 'express';
import upload from '../middleware/uploadMiddleware.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', protect, adminOnly, upload.single('image'), (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No file uploaded');
  }
  res.status(201).json({ image: `/uploads/${req.file.filename}` });
});

export default router;
