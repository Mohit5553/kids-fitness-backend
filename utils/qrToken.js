import jwt from 'jsonwebtoken';

export const signQrToken = (payload, expiresIn = '6h') => {
  const secret = process.env.QR_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('QR_SECRET or JWT_SECRET is required');
  }
  return jwt.sign(payload, secret, { expiresIn });
};

export const verifyQrToken = (token) => {
  const secret = process.env.QR_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('QR_SECRET or JWT_SECRET is required');
  }
  return jwt.verify(token, secret);
};
