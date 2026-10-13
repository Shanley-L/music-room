# Music Room – Security note

This note covers subject sections V.6 (Securing) and V.8 (credentials). It lists
the hazards we identified, the protection we put in place for each one, and the
risk that remains. The API is not meant to be unbreakable. The goal is to protect
users from the attacks you can reasonably expect against a mobile backend.

Code references are relative to `Api/src`. Tests that cover these protections are
in `Api/test/security.test.js` and in the per-feature suites.

## Credentials and configuration

- Secrets (JWT secrets, Google client ids, SMTP credentials, database URLs)
  come only from `Api/.env`. Git ignores that file (root and `Api/.gitignore`).
  `Api/.env.example` lists every variable with empty or local-only values.
- The API refuses to start if `JWT_SECRET` or `JWT_REFRESH_SECRET` is missing,
  shorter than 32 characters, or if the two are equal (`middleware/auth.js`). The
  code has no default secret, so tokens can never be signed with a value that is
  published in the repository.
- `make env` creates `Api/.env` from the example and fills both JWT secrets with
  32 random bytes.
- Residual: an old commit (`1fdbde0`, later reverted) contained an `Api/.env` with
  local Docker database credentials only. It held no API keys. Those credentials
  must not be reused anywhere.

## Hazards and protections

### 1. Brute force (login, OTP codes, invite codes)

- **Authentication endpoints**: 30 requests per 15 min (`authLimiter`). The
  public endpoints (`register`, `login`, `google`, `oauth`, `verify-email`,
  `forgot-password`, `reset-password`) count per IP. `link-google` and
  `link-oauth` run after authentication, so they count per user. Passwords are
  hashed with bcrypt (cost 10).
- **One-time codes** (email verification, password reset): 6 digits drawn with
  `crypto.randomInt`. Each code allows at most 5 attempts per account, concurrent
  attempts included (counter in Redis, in memory if Redis is down). After that
  the code is invalidated (`400 CODE_ATTEMPTS_EXCEEDED`). A reset code is cleared,
  so the user must call `forgot-password` again. A verification code is replaced
  by a new one sent by email. A reset code also expires after 1 h.
- **Invite codes**: 10 symbols from a 32-symbol alphabet with no ambiguous
  characters (`I`, `O`, `0`, `1` removed). That is 50 bits, about 1.1e15
  combinations (`lib/inviteCode.js`). Room and playlist joins share one budget:
  10 failed attempts per 15 min per user (`joinCodeLimiter`; successful joins
  do not count). The owner can regenerate a code with
  `POST /api/rooms/:id/invite-code` or `POST /api/playlists/:id/invite-code`. The
  old code stops working immediately.
- Residual: rooms and playlists created before this change keep their legacy
  short codes (8 or 6 hex characters) until the owner regenerates them. There is
  no migration. The per-user limit still applies to them.
- **Global limiter**: 500 requests per 15 min per IP on the whole API.
- Residual: an attacker can make a victim's code be replaced or cleared (5 bad
  attempts). That is a nuisance, not an account takeover; the auth limiter
  bounds it.

### 2. Session theft

- Access tokens are short-lived JWTs (1 h). Refresh tokens last 7 days, are stored
  server-side (`RefreshToken`), and rotate on every use: a used refresh token is
  revoked.
- Logout revokes the refresh token and blacklists the access token in Redis until
  it expires. Both REST and Socket.IO check that blacklist (`lib/realtime.js`). A
  socket is disconnected when its JWT expires.
- Tokens only travel in the `Authorization` header or the Socket.IO `auth`
  payload, never in URLs, so they do not appear in the access logs.
- Residual: the API does not terminate TLS itself, so production must run behind
  an HTTPS reverse proxy. Reusing an already rotated refresh token is rejected,
  but this does not revoke the whole token family.

### 3. Token replay / forged tokens

- Every token is verified against the server secret (HS256), and each one carries
  a unique `jti`. Access and refresh tokens use different secrets, so one cannot
  stand in for the other.
- Residual: a stolen access token can be replayed until it expires (1 h at most)
  unless its owner logs out.

### 4. Third-party sign-in (Google)

- The app signs in with Google through `expo-auth-session` and sends the Google
  ID token to `POST /api/auth/google` (login / sign-up) or
  `POST /api/auth/link-google` (link to the signed-in account).
- The server checks every token with Google (`lib/googleVerify.js`, tokeninfo
  endpoint: signature and expiry), then checks that the issuer is Google, that
  the token has not expired, and that its audience is one of our client ids
  (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID_ANDROID`/`_IOS`/`_WEB`): `aud` for an ID
  token (`azp` alone is not enough), `aud` or `issued_to` for an access token.
  Otherwise it answers `401 INVALID_GOOGLE_TOKEN`. Ids, emails or names sent in
  the request body are never used as proof of identity.
- An existing account is matched by Google email only when Google says the email
  is verified (`email_verified`), otherwise `401 GOOGLE_EMAIL_UNVERIFIED`. If that
  account had never verified its email, its password is removed and all its
  refresh tokens are deleted when Google is linked, so whoever registered the
  address first cannot keep a way in. An account already linked to a different
  Google account is never merged (`409 GOOGLE_ACCOUNT_CONFLICT`).
- Linking from the profile (`link-google`) needs a verified account email
  (`403 EMAIL_NOT_VERIFIED`; an unverified account is reclaimed by signing in with
  Google instead). A Google account linked to one user cannot be linked to another
  (`409 GOOGLE_ACCOUNT_IN_USE`), and a user who already has a different Google
  account linked cannot replace it (`409 GOOGLE_ALREADY_LINKED`).
- `POST /api/auth/oauth` and `/api/auth/link-oauth` are a simulated login for
  local development. They answer `404` unless `ALLOW_DEV_OAUTH=true` and
  `NODE_ENV` is exactly `development` or `test`. Simulated ids are prefixed with `dev:` so they
  never match a real Google account, and an email that already has an account is
  refused rather than merged.
- Resolved: the former open issue (body-supplied `providerId`/`email` accepted as
  identity, and no audience check). Tests: `test/oauth.test.js`.
- Residual: if Google cannot be reached (network error, 5xx or 429 from
  tokeninfo) the API answers `502 GOOGLE_UNAVAILABLE` and nobody can sign
  in with Google until it is back.

### 5. Enumeration

- User ids are CUIDs (not sequential). Room and playlist invite codes are random
  and limited per user (see 1).
- User search returns only `{ id, name }`, at most 20 results, and needs a query
  of at least 2 characters. It is limited to 30 requests per minute per user
  (`userSearchLimiter`).
- Private rooms and playlists never appear in public listings. Invite codes and
  invite lists are only returned to the owner.
- Residual: `register` and `forgot-password` responses can reveal whether an
  email is registered. The auth limiter bounds this.

### 6. Data isolation and leakage

- Every route except auth, Deezer search and public profiles needs a JWT. The
  caller is always `req.user.id`: ids sent in the body or query are ignored.
- Profiles (`services/userService.js`) have three levels. Everyone sees `name`,
  `avatarUrl`, `bio` and `musicPreferences`. Accepted friends (a `Friendship` in
  status `ACCEPTED`; a pending request is not enough) also see `friendsInfo`.
  Only the owner sees `email`, `privateInfo` and linked accounts. Nobody ever sees
  password hashes or verification and reset codes.
- Rooms, playlists, devices and delegations check visibility, license and
  ownership on the server, for both REST and sockets.
- Errors return generic messages. Stack traces are only written to the server log.

### 7. Spoofed geolocation

- For `GEO_TIME_RESTRICTED` rooms, the server applies the time window with its
  own clock and checks the position against the zone (haversine distance).
- Residual: the position comes from the client, and a modified app or a GPS
  spoofer can fake it. The server cannot prove where a phone is. Possible further
  steps (not implemented): plausibility checks (impossible travel between two
  votes), device attestation (Play Integrity / App Attest), or an on-site QR code
  or beacon.

### 8. Flooding / DoS and vote spam

- Votes and unvotes: 60 per minute per user (`voteLimiter`). One vote per user per
  track is enforced in the database, under a room lock.
- Friend requests: 20 per 15 min per user. Device registrations: 20 per 15 min
  per user.
- Sockets: at most 50 subscribed channels per socket. Delegation commands and
  player states are each limited to 10 per second per socket, and a state payload
  is capped at 8 KB.
- Every limiter answers `429 { error, code: 'RATE_LIMITED' }`. Limiters are keyed
  by user id once the caller is authenticated, and by IP otherwise.
- Limits can be tuned with `RATE_LIMIT_<NAME>_MAX` / `_WINDOW_MS` (whole positive
  numbers only; any other value keeps the default). `RATE_LIMIT_DISABLED` is
  ignored when `NODE_ENV=production`.
- Client IP: `TRUST_PROXY` is off by default, so `X-Forwarded-For` is ignored and
  a client cannot pick its own IP to get around per-IP limits. Behind a reverse
  proxy, set it to the number of proxy hops (e.g. `1`) or to the proxy's address
  or subnet. Otherwise every client would share the proxy's IP.
- Residual: limiter counters live in each process's memory, so the effective
  limit grows with the number of API instances. With several instances, use a
  shared store (Redis) for the counters. Volumetric attacks have to be absorbed
  upstream (reverse proxy / CDN). Creating many accounts gets around per-user
  limits but still hits the per-IP limits.

### 9. Injection

- All database access goes through Prisma, with parameterized queries. The only
  raw SQL is `pg_advisory_xact_lock` with bound parameters. Search queries escape
  the `LIKE` wildcards.
- Inputs are validated with zod or explicit checks: types, enums, lengths, date
  formats.
- Log forging: before anything is written to stdout or `SystemLog`, the
  client-supplied values that get logged (platform, device, app version headers
  and socket `auth` fields, socket ids) have their control characters (CR, LF,
  ESC, ...) replaced with spaces and are truncated (`sanitizeLogValue` in
  `middleware/logger.js`). One request always gives exactly one log line.
- The JSON body parser has Express's default size limit (100 kB).

### 10. Socket abuse

- Sockets authenticate with the same JWT as REST at handshake time and are
  rejected (`UNAUTHORIZED`) otherwise. Joining a channel repeats the REST access
  checks.
- Clients only receive broadcasts. Every write goes through REST, except relayed
  delegation commands, which check the per-device rights (`canControl`).
- When access is revoked (invite removed, unfriended, delegation revoked), the
  affected sockets are evicted from the channel and notified.
- Residual: `CORS_ORIGIN` defaults to `*`. Production should set it to the real
  origins.

## Action logs (subject V.6)

Every HTTP request (`middleware/logger.js`) and every socket event
(`lib/realtime.js`) writes a line to stdout and a `SystemLog` row with:
platform, device, app version, user id (when authenticated), IP, endpoint/event
and status. The mobile app sends `X-Platform`, `X-Device` and `X-App-Version` on
REST calls, and `platform`, `device` and `appVersion` in the socket `auth`
payload. `test/security.test.js` covers both.
