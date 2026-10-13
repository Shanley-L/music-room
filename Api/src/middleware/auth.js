import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { isTokenBlacklisted } from '../lib/redis.js';

/**
 * JWT secrets come from the environment only (Api/.env, git-ignored). There is no
 * fallback: a missing, short or shared secret stops the process at startup instead
 * of signing tokens with a guessable value.
 */
export const MIN_SECRET_LENGTH = 32;

function refuseToStart(message) {
  console.error(`[Config] ${message}`);
  throw new Error(message);
}

function requireSecret(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    refuseToStart(
      `${name} is not set: refusing to start. ` +
        'Define it in Api/.env (see Api/.env.example), e.g. with `openssl rand -hex 32`.'
    );
  }
  if (value.length < MIN_SECRET_LENGTH) {
    refuseToStart(
      `${name} is too short (${value.length} characters, ${MIN_SECRET_LENGTH} minimum): refusing to start. ` +
        'Generate one with `openssl rand -hex 32`.'
    );
  }
  return value;
}

export const JWT_SECRET = requireSecret('JWT_SECRET');
export const JWT_REFRESH_SECRET = requireSecret('JWT_REFRESH_SECRET');

// With one shared secret, a refresh token would also be accepted as an access token.
if (JWT_SECRET === JWT_REFRESH_SECRET) {
  refuseToStart('JWT_SECRET and JWT_REFRESH_SECRET must be different: refusing to start.');
}

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
    }
  } catch (e) {
    // ignore
  }
  next();
}
