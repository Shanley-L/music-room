import prisma from '../lib/prisma.js';

export function requestLogger(req, res, next) {
  const start = Date.now();
  const platform = req.headers['x-platform'] || req.headers['user-agent'] || 'Unknown Platform';
  const device = req.headers['x-device'] || 'Unknown Device';
  const appVersion = req.headers['x-app-version'] || '1.0.0';
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
