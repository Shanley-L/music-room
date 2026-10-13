import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Rate limiters (anti-bruteforce / anti-flooding). See docs/SECURITY.md.
 *
 * Every limiter answers 429 `{ error, code: 'RATE_LIMITED' }` and is keyed by the
 * authenticated user id when the route runs behind authMiddleware, else by IP.
 *
 * Limits are read from the environment when the limiter is created (process start):
 * - RATE_LIMIT_<NAME>_MAX and RATE_LIMIT_<NAME>_WINDOW_MS override one limiter
 *   (NAME = AUTH, API, JOIN_CODE, USER_SEARCH, FRIEND_REQUEST, VOTE, DEVICE_REGISTER, PLAYBACK);
 * - RATE_LIMIT_DISABLED=true turns every limiter off, for local tooling only:
 *   it is ignored when NODE_ENV=production.
 */

const disabled =
  process.env.RATE_LIMIT_DISABLED === 'true' && process.env.NODE_ENV !== 'production';

/** Strict: only a whole positive number is accepted ('10abc', '1.5', '0' fall back). */
export function positiveInt(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function userOrIpKey(req) {
  if (req.user?.id) return `user:${req.user.id}`;
  return `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || '')}`;
}

export function createLimiter(name, { windowMs, max, error, skipSuccessfulRequests = false }) {
  const envName = `RATE_LIMIT_${name}`;
  const limit = positiveInt(process.env[`${envName}_MAX`], max);
  const window = positiveInt(process.env[`${envName}_WINDOW_MS`], windowMs);

  return rateLimit({
    windowMs: window,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    skipSuccessfulRequests,
    skip: () => disabled,
    handler: (req, res) => {
      res.status(429).json({ error, code: 'RATE_LIMITED' });
    },
  });
}

const MINUTE = 60 * 1000;

// Authentication endpoints (login, register, OAuth, password reset): per IP.
export const authLimiter = createLimiter('AUTH', {
  windowMs: 15 * MINUTE,
  max: 30,
  error: 'Trop de tentatives de connexion / inscription. Veuillez réessayer dans 15 minutes.',
});

// Global limiter on the whole API, mounted before authentication: per IP.
export const standardApiLimiter = createLimiter('API', {
  windowMs: 15 * MINUTE,
  max: 500,
  error: 'Trop de requêtes vers l’API. Veuillez ralentir.',
});

// Joining a room or a playlist by invite code (one shared budget): anti code
// enumeration. Only failed attempts (status >= 400) count.
export const joinCodeLimiter = createLimiter('JOIN_CODE', {
  windowMs: 15 * MINUTE,
  max: 10,
  skipSuccessfulRequests: true,
  error: 'Trop de tentatives de code d’invitation. Réessayez plus tard.',
});

// User search by name: anti user enumeration / scraping.
export const userSearchLimiter = createLimiter('USER_SEARCH', {
  windowMs: MINUTE,
  max: 30,
  error: 'Trop de recherches. Veuillez ralentir.',
});

// Friend requests: anti spam.
export const friendRequestLimiter = createLimiter('FRIEND_REQUEST', {
  windowMs: 15 * MINUTE,
  max: 20,
  error: 'Trop de demandes d’ami. Réessayez plus tard.',
});

// Votes and vote removals: anti vote flooding.
export const voteLimiter = createLimiter('VOTE', {
  windowMs: MINUTE,
  max: 60,
  error: 'Trop de votes. Veuillez ralentir.',
});

// Playback controls and `ended` reports of a room: anti flooding.
export const playbackLimiter = createLimiter('PLAYBACK', {
  windowMs: MINUTE,
  max: 120,
  error: 'Trop de requêtes de lecture. Veuillez ralentir.',
});

// Device registration: bounds the number of devices (and delegation targets) created.
export const deviceRegisterLimiter = createLimiter('DEVICE_REGISTER', {
  windowMs: 15 * MINUTE,
  max: 20,
  error: 'Trop d’enregistrements d’appareils. Réessayez plus tard.',
});
