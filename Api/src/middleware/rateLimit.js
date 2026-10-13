import rateLimit from 'express-rate-limit';

// Strict limiter for sensitive authentication endpoints (anti-bruteforce)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '30', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.DISABLE_RATE_LIMIT === 'true' || req.headers['x-load-test'] === 'musicroom-benchmark',
  message: {
    error: 'Trop de tentatives de connexion / inscription. Veuillez réessayer dans 15 minutes.',
  },
});

// Standard API limiter
export const standardApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '500', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.DISABLE_RATE_LIMIT === 'true' || req.headers['x-load-test'] === 'musicroom-benchmark',
  message: {
    error: 'Trop de requêtes vers l’API. Veuillez ralentir.',
  },
});
