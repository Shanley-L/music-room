import prisma from '../lib/prisma.js';

/**
 * Client-supplied values (headers, socket auth payload) are logged as one line:
 * control characters (CR, LF, ESC, ...) become spaces (no log forging) and the
 * value is truncated to `max` characters.
 */
export function sanitizeLogValue(value, max = 100) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .slice(0, max);
}

export function requestLogger(req, res, next) {
  const start = Date.now();
  const platform = sanitizeLogValue(req.headers['x-platform'] || req.headers['user-agent'] || 'Unknown Platform');
  const device = sanitizeLogValue(req.headers['x-device'] || 'Unknown Device');
  const appVersion = sanitizeLogValue(req.headers['x-app-version'] || '1.0.0', 50);
  const ip = req.ip || req.socket?.remoteAddress;

  // Intercept completion
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const userId = req.user?.id || null;
    const method = req.method;
    const endpoint = req.originalUrl || req.url;

    console.log(
      `[LOG] ${new Date().toISOString()} | ${method} ${endpoint} ${statusCode} | ${duration}ms | ` +
      `Platform: ${platform} | Device: ${device} | Version: ${appVersion} | User: ${userId || 'anon'}`
    );

    // Save to DB asynchronously (ignore failures so request is never blocked)
    if (endpoint !== '/health') {
      prisma.systemLog.create({
        data: {
          userId,
          action: `${method} ${endpoint}`,
          method,
          endpoint,
          platform: String(platform).slice(0, 100),
          device: String(device).slice(0, 100),
          appVersion: String(appVersion).slice(0, 50),
          ip: String(ip || '').slice(0, 50),
          statusCode,
        },
      }).catch(() => {
        // Silently catch if DB is not ready during tests/migration
      });
    }
  });

  next();
}
