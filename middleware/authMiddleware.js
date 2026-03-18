import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/User.js';

export const protect = asyncHandler(async (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.split(' ')[1] : null;

  if (!token) {
    console.error('Auth Middleware: Token missing');
    res.status(401);
    throw new Error('Not authorized, token missing');
  }

  // Token format check
  const parts = token.split('.');
  if (parts.length !== 3) {
    console.error(`Auth Middleware: Invalid token format (parts: ${parts.length})`);
    res.status(401);
    throw new Error('Not authorized, token format invalid');
  }

  try {
    if (!process.env.JWT_SECRET) {
      console.error('Auth Middleware: JWT_SECRET is missing from environment!');
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
      console.error(`Auth Middleware: User not found for ID ${decoded.id}`);
      res.status(401);
      throw new Error('Not authorized, user not found');
    }
    next();
  } catch (err) {
    console.error(`Auth Middleware: Token invalid - Details: ${err.message}`);
    res.status(401);
    throw new Error(`Not authorized, token invalid: ${err.message}`);
  }
});

export const optionalAuth = asyncHandler(async (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.split(' ')[1] : null;

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    next();
  } catch (err) {
    // If token is invalid but provided, we might just ignore it or log it
    // For guest access, we'll just move on without setting req.user
    next();
  }
});

export const adminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
    next();
  } else {
    res.status(403);
    throw new Error('Admin access required');
  }
};
