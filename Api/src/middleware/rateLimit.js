import rateLimit from 'express-rate-limit';

// Strict limiter for sensitive authentication endpoints (anti-bruteforce)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 100, // 15 minutes
  max: 30, // max 30 attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Trop de tentatives de connexion / inscription. Veuillez réessayer dans 15 minutes.',
  },
});

// Standard API limiter
export const standardApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Trop de requêtes vers l’API. Veuillez ralentir.',
  },
});
