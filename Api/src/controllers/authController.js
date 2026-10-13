import * as authService from '../services/authService.js';
import {
  verifyGoogleToken,
  GoogleAuthError,
  allowedGoogleClientIds,
  devOAuthEnabled,
} from '../lib/googleVerify.js';

export async function register(req, res) {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password et name sont obligatoires' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  }

  const result = await authService.register({ email, password, name });
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(201).json(result);
}

export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email et password sont obligatoires' });
  }

  const result = await authService.login({ email, password });
  if (result.error) {
    return res.status(result.status).json({
      error: result.error,
      emailVerificationRequired: result.emailVerificationRequired || false,
      email: result.email || undefined,
    });
  }

  return res.json(result);
}

export async function refreshToken(req, res) {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken est obligatoire' });
  }

  const result = await authService.refreshAccessToken(refreshToken);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result);
}

export async function logout(req, res) {
  const authHeader = req.headers.authorization;
  const accessToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const { refreshToken } = req.body;

  await authService.logout(accessToken, refreshToken);
  return res.json({ success: true, message: 'Déconnecté avec succès' });
}

export async function verifyEmail(req, res) {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'email et code sont obligatoires' });
  }

  const result = await authService.verifyEmail(email, code);
  if (result.error) {
    const body = { error: result.error };
    if (result.code) body.code = result.code;
    return res.status(result.status).json(body);
  }

  return res.json(result);
}

function sendError(res, result) {
  const body = { error: result.error };
  if (result.code) body.code = result.code;
  return res.status(result.status).json(body);
}

/** Verifies the Google token from the body; sends the error response and returns null on failure. */
async function verifiedGoogleIdentity(req, res) {
  const { idToken, token, accessToken } = req.body || {};
  try {
    return await verifyGoogleToken({
      idToken: typeof idToken === 'string' ? idToken : undefined,
      accessToken:
        typeof accessToken === 'string' ? accessToken : typeof token === 'string' ? token : undefined,
    });
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      sendError(res, err);
      return null;
    }
    throw err;
  }
}

/** POST /auth/google: login or sign-up with a Google ID token (or access token). */
export async function googleAuth(req, res) {
  const identity = await verifiedGoogleIdentity(req, res);
  if (!identity) return;

  const result = await authService.googleLogin(identity);
  if (result.error) return sendError(res, result);
  return res.json(result);
}

/** POST /auth/link-google: links the Google account behind the token to the caller. */
export async function linkGoogle(req, res) {
  const identity = await verifiedGoogleIdentity(req, res);
  if (!identity) return;

  const result = await authService.linkGoogleAccount(req.user.id, identity);
  if (result.error) return sendError(res, result);
  return res.json(result);
}

/** GET /auth/providers: what the login screen may offer. */
export function providers(req, res) {
  return res.json({
    google: allowedGoogleClientIds().length > 0,
    devOAuth: devOAuthEnabled(),
  });
}

const devDisabled = (res) => res.status(404).json({ error: 'Route introuvable', code: 'NOT_FOUND' });

function devProviderId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : null;
}

/** POST /auth/oauth: DEV ONLY simulated login (ALLOW_DEV_OAUTH=true, never in production). */
export async function oauthLogin(req, res) {
  if (!devOAuthEnabled()) return devDisabled(res);

  const { provider, email, name } = req.body || {};
  const providerId = devProviderId(req.body?.providerId);
  if (provider !== 'google' || !providerId) {
    return res.status(400).json({ error: 'provider (google) et providerId sont obligatoires' });
  }
  if (email !== undefined && (typeof email !== 'string' || email.length > 254)) {
    return res.status(400).json({ error: 'email invalide' });
  }

  const result = await authService.devOAuthLogin({
    providerId,
    email,
    name: typeof name === 'string' ? name : undefined,
  });
  if (result.error) return sendError(res, result);
  return res.json(result);
}

/** POST /auth/link-oauth: DEV ONLY simulated link (ALLOW_DEV_OAUTH=true, never in production). */
export async function linkOAuth(req, res) {
  if (!devOAuthEnabled()) return devDisabled(res);

  const { provider } = req.body || {};
  const providerId = devProviderId(req.body?.providerId);
  if (provider !== 'google' || !providerId) {
    return res.status(400).json({ error: 'provider et providerId sont obligatoires' });
  }

  const result = await authService.devLinkOAuth(req.user.id, { providerId });
  if (result.error) return sendError(res, result);
  return res.json(result);
}

export async function forgotPassword(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email est obligatoire' });
  }

  const result = await authService.forgotPassword(email);
  return res.json(result);
}

export async function resetPassword(req, res) {
  const { email, resetCode, newPassword } = req.body;

  if (!email || !resetCode || !newPassword) {
    return res.status(400).json({ error: 'email, resetCode et newPassword sont obligatoires' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
  }

  const result = await authService.resetPassword(email, resetCode, newPassword);
  if (result.error) {
    const body = { error: result.error };
    if (result.code) body.code = result.code;
    return res.status(result.status).json(body);
  }

  return res.json(result);
}
