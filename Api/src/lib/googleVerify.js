/**
 * Server-side verification of Google credentials (see docs/SECURITY.md, section 4).
 *
 * A Google identity is accepted only when Google itself confirms the token
 * (tokeninfo endpoint: signature, expiry), the token was issued for one of our
 * client ids (`aud` / `azp`), and it has not expired. Nothing the client sends
 * about the user (id, email, name) is trusted.
 *
 * Accepted client ids come from the environment, read at call time:
 * GOOGLE_CLIENT_ID, GOOGLE_CLIENT_ID_ANDROID, GOOGLE_CLIENT_ID_IOS, GOOGLE_CLIENT_ID_WEB.
 *
 * Tests replace the network call with `setTokenInfoFetcher` (no request to Google).
 */

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const FETCH_TIMEOUT_MS = 5000;

export class GoogleAuthError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function allowedGoogleClientIds() {
  return [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_ID_ANDROID,
    process.env.GOOGLE_CLIENT_ID_IOS,
    process.env.GOOGLE_CLIENT_ID_WEB,
  ]
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean);
}

/**
 * Default fetcher: asks Google about the token. Returns the tokeninfo JSON, or
 * null when Google rejects it (bad signature, expired, revoked...).
 * `kind` is 'id_token' or 'access_token'.
 */
async function defaultTokenInfoFetcher(kind, token) {
  const url = `${TOKENINFO_URL}?${kind}=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  // 400/401: Google rejects the token. Anything else (5xx, 429...) is an outage.
  if (res.status === 400 || res.status === 401) return null;
  if (!res.ok) throw new Error(`tokeninfo answered ${res.status}`);
  const info = await res.json();

  // tokeninfo for an access token carries no profile: fetch it with the same token.
  if (kind === 'access_token' && !info.name) {
    const profile = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (profile.ok) {
      const data = await profile.json();
      return { ...data, ...info, name: data.name, picture: data.picture };
    }
  }
  return info;
}

let tokenInfoFetcher = defaultTokenInfoFetcher;

/** Test hook: replace the call to Google. `fn(kind, token)` returns tokeninfo JSON or null. */
export function setTokenInfoFetcher(fn) {
  tokenInfoFetcher = fn;
}

export function resetTokenInfoFetcher() {
  tokenInfoFetcher = defaultTokenInfoFetcher;
}

function isTrue(value) {
  return value === true || value === 'true';
}

const invalid = () => new GoogleAuthError('INVALID_GOOGLE_TOKEN', 'Token Google invalide ou expiré');

/**
 * Verifies a Google ID token (preferred) or access token.
 * Returns `{ sub, email, emailVerified, name, picture }`; throws GoogleAuthError.
 */
export async function verifyGoogleToken({ idToken, accessToken } = {}) {
  const kind = idToken ? 'id_token' : accessToken ? 'access_token' : null;
  const token = idToken || accessToken;
  if (!kind || typeof token !== 'string' || token.length > 4096) {
    throw new GoogleAuthError('GOOGLE_TOKEN_REQUIRED', 'Token Google manquant', 400);
  }

  const allowed = allowedGoogleClientIds();
  if (allowed.length === 0) {
    throw new GoogleAuthError(
      'GOOGLE_NOT_CONFIGURED',
      'La connexion Google n’est pas configurée sur ce serveur',
      503
    );
  }

  let info;
  try {
    info = await tokenInfoFetcher(kind, token);
  } catch (err) {
    console.error('[Google verify] tokeninfo request failed:', err?.message);
    throw new GoogleAuthError(
      'GOOGLE_UNAVAILABLE',
      'Impossible de vérifier le token auprès de Google',
      502
    );
  }
  if (!info || typeof info !== 'object' || info.error || info.error_description) throw invalid();

  // Audience: an ID token must name one of our clients in `aud` (`azp` alone is
  // not enough); an access token in `aud` or `issued_to`.
  const audiences = kind === 'id_token' ? [info.aud] : [info.aud, info.issued_to];
  if (!audiences.some((aud) => typeof aud === 'string' && allowed.includes(aud))) throw invalid();

  if (kind === 'id_token' && !GOOGLE_ISSUERS.has(info.iss)) throw invalid();

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (info.exp !== undefined) {
    if (!(Number(info.exp) > nowSeconds)) throw invalid();
  } else if (info.expires_in !== undefined) {
    if (!(Number(info.expires_in) > 0)) throw invalid();
  } else {
    throw invalid();
  }

  const sub = info.sub || info.user_id;
  if (!sub || typeof sub !== 'string') throw invalid();

  return {
    sub,
    email: typeof info.email === 'string' ? info.email.toLowerCase() : null,
    emailVerified: isTrue(info.email_verified) || isTrue(info.verified_email),
    name: typeof info.name === 'string' ? info.name : null,
    picture: typeof info.picture === 'string' ? info.picture : null,
  };
}

/**
 * The simulated (body-supplied) OAuth login is for local development only:
 * ALLOW_DEV_OAUTH=true AND NODE_ENV exactly 'development' or 'test'.
 */
export function devOAuthEnabled() {
  const env = process.env.NODE_ENV;
  return process.env.ALLOW_DEV_OAUTH === 'true' && (env === 'development' || env === 'test');
}
