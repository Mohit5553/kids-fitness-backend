import dotenv from 'dotenv';
dotenv.config();
if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined in .env file!');
  process.exit(1);
}
console.log('JWT_SECRET verified and loaded.');

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';

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
import specialtyRoutes from './routes/specialtyRoutes.js';
import roleRoutes from './routes/roleRoutes.js';

const app = express();
const httpServer = createServer(app);
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Make io accessible in controllers
app.set('io', io);

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join_admin', () => {
    socket.join('admin_room');
    console.log('Client joined admin room:', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.use(express.json());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(morgan('dev'));
app.use(locationMiddleware);

const __dirname = path.resolve();
app.use('/uploads', express.static(path.join(__dirname, '/uploads')));

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'jts-booking-backend' });
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
app.use('/api/upload', uploadRoutes);
app.use('/api/specialties', specialtyRoutes);
app.use('/api/roles', roleRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('DB connection failed', err);
    process.exit(1);
  });
