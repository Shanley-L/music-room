import { createHmac, timingSafeEqual } from 'crypto';

export function authMiddleware(req, res, next) {
  const devUserId = req.headers['x-dev-user-id'];

  if (devUserId) {
    req.user = { id: devUserId };
    return next();
  }

  return res.status(401).json({ error: 'Non authentifié' });
}

function readJwt(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const [header, payload, signature] = String(token).split('.');

  if (!header || !payload || !signature) return null;

  try {
    const expected = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(signature);

    if (expectedBuf.length !== signatureBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, signatureBuf)) return null;

    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    );

    if (typeof claims !== 'object' || claims === null) return null;

    const nowSec = Math.floor(Date.now() / 1000);

    if (typeof claims.exp === 'number' && nowSec >= claims.exp) return null;
    if (typeof claims.nbf === 'number' && nowSec < claims.nbf) return null;

    return claims;
  } catch {
    return null;
  }
}

export function socketAuthMiddleware(socket, next) {
  const auth = socket.handshake?.auth ?? {};
  const token = auth.token;
  const devUserId = auth['x-dev-user-id'];

  const meta = {
    platform: auth.platform,
    device: auth.device,
    appVersion: auth.appVersion,
  };

  if (process.env.NODE_ENV === 'production') {
    if (!token) {
      return next(new Error('Non authentifié : JWT requis en production'));
    }

    const claims = readJwt(token);
    if (!claims || typeof claims.sub !== 'string' || !claims.sub) {
      return next(new Error('Jeton invalide'));
    }

    socket.user = { id: claims.sub };
    socket.meta = {
      platform: claims.platform ?? auth.platform,
      device: claims.device ?? auth.device,
      appVersion: claims.appVersion ?? auth.appVersion,
    };
    return next();
  }

  if (devUserId) {
    socket.user = { id: devUserId };
    socket.meta = meta;
    return next();
  }

  return next(new Error('Non authentifié'));
}
