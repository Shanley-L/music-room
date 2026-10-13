import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requestLogger } from './middleware/logger.js';
import { standardApiLimiter } from './middleware/rateLimit.js';
import { setupSwagger } from './lib/swagger.js';
import { authMiddleware } from './middleware/auth.js';

import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import deezerRoutes from './routes/deezerRoutes.js';
import playlistRoutes from './routes/playlistRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import playbackRoutes from './routes/playbackRoutes.js';
import trackRoutes from './routes/trackRoutes.js';
import deviceRoutes from './routes/deviceRoutes.js';
import friendRoutes from './routes/friendRoutes.js';
import delegationRoutes from './routes/delegationRoutes.js';

const app = express();

/**
 * TRUST_PROXY (default off): set only behind a reverse proxy, so req.ip (logs,
 * per-IP rate limits) is the client address from X-Forwarded-For instead of the
 * proxy's. Accepts a hop count ("1"), "true" (trust every hop: only if the API is
 * unreachable except through the proxy) or Express values ("loopback", subnets).
 * Left off, a client cannot spoof its IP with X-Forwarded-For.
 */
export function parseTrustProxy(value) {
  if (value == null) return false;
  const v = String(value).trim();
  if (v === '' || v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Mandatory request logging (Platform, Device, Version)
app.use(requestLogger);

// Global Rate Limiter
app.use(standardApiLimiter);

// Health check endpoint
app.get('/health', (req, res) => res.json({ ok: true }));

// Swagger OpenAPI documentation
setupSwagger(app);

// Application routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/deezer', deezerRoutes);
app.use('/api/playlists', authMiddleware, playlistRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/rooms/:roomId/tracks', trackRoutes);
app.use('/api/rooms/:roomId/playback', playbackRoutes);
app.use('/api/devices', authMiddleware, deviceRoutes);
app.use('/api/friends', authMiddleware, friendRoutes);
app.use('/api/delegations', authMiddleware, delegationRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ error: 'Une erreur interne est survenue', code: 'INTERNAL_ERROR' });
});

export default app;
export { app };
