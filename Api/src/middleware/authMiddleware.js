import jwt from 'jsonwebtoken';
import redisClient from '../lib/redis.js';

const JWT_SECRET = process.env.JWT_SECRET || 'music-room-secret';

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ message: 'Missing or malformed authorization token' });
      return;
    }

    const token = authHeader.split(' ')[1];

    const isBlacklisted = await redisClient.get(`bl_${token}`);
    if (isBlacklisted) {
      res.status(401).json({ message: 'Token has been revoked. Please log in again.' });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid or expired access token' });
  }
}