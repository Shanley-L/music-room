import jwt from 'jsonwebtoken';
import { isTokenBlacklisted } from '../lib/redis.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'music-room-super-secret-jwt-key-2026';
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'music-room-super-secret-refresh-key-2026';

export async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];

      const blacklisted = await isTokenBlacklisted(token);
      if (blacklisted) {
        return res.status(401).json({ error: 'Token révoqué / déconnecté' });
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        name: decoded.name,
      };
      return next();
    }

    // Dev fallback for backwards compatibility
    const devUserId = req.headers['x-dev-user-id'];
    if (devUserId) {
      req.user = { id: devUserId, email: `${devUserId}@dev.local`, name: `Dev ${devUserId}` };
      return next();
    }

    return res.status(401).json({ error: 'Non authentifié : token manquant' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
}

export async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const blacklisted = await isTokenBlacklisted(token);
      if (!blacklisted) {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { id: decoded.sub, email: decoded.email, name: decoded.name };
      }
    } else if (req.headers['x-dev-user-id']) {
      req.user = { id: req.headers['x-dev-user-id'] };
    }
  } catch (e) {
    // ignore
  }
  next();
}
