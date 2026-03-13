import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';

import connectDB from './config/db.js';
import { notFound, errorHandler } from './middleware/errorMiddleware.js';
import { locationMiddleware } from './middleware/locationMiddleware.js';

import authRoutes from './routes/authRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import classRoutes from './routes/classRoutes.js';
import planRoutes from './routes/planRoutes.js';
import childRoutes from './routes/childRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import userRoutes from './routes/userRoutes.js';
import trainerRoutes from './routes/trainerRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import membershipRoutes from './routes/membershipRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import trialRoutes from './routes/trialRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';

dotenv.config();

const app = express();

app.use(express.json());
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);
app.use(morgan('dev'));
app.use(locationMiddleware);
app.use('/uploads', express.static(path.join(path.resolve(), 'uploads')));

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'kids-fitness-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/children', childRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/trainers', trainerRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/memberships', membershipRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/trials', trialRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/upload', uploadRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('DB connection failed', err);
    process.exit(1);
  });
