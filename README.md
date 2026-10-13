# Music Room

Music Room is a collaborative music app (42 subject, version 6). It has a Node.js
back-end and a React Native (Expo) mobile app, and it implements all three
services:

- **Music Track Vote**: live events where users suggest tracks and vote; the
  most-voted track moves up the queue and plays next. Everyone in the room
  listens to the same track in sync (server-driven playback); the owner controls
  play/pause/skip and manages the room. Public/private visibility; licenses:
  everyone, invited only, or place + time window.
- **Music Playlist Editor**: playlists edited by several users in real time.
  Public/private visibility; licenses: everyone edits, or invited users only.
- **Music Control Delegation**: each device registered on an account has its own
  license; the owner gives friends control of it (play/pause, skip, volume) and
  their commands are relayed to the device in real time.

Accounts use email/password (email verification, password reset) or Google
sign-in. Google can also be linked to an existing account. Profiles have public,
friends-only and private fields, plus music preferences.

## Architecture

```
 Mobile app (Expo / React Native)          configurable API URL, X-Platform/X-Device/X-App-Version
   |  REST + JSON (writes, reads)  |  Socket.IO (subscriptions, broadcasts, delegation relay)
   v                               v
 +-----------------------------------------------+
 | API: Node.js + Express 5 + Socket.IO (Api/)   |  Swagger at /api-docs
 |  routes -> controllers -> services -> Prisma  |  JWT auth, zod validation, rate limits,
 +-----------------------------------------------+  request/socket logs (SystemLog)
        |                         |
        v                         v
   PostgreSQL 16              Redis 7
   (source of truth:          (JWT blacklist on logout, Socket.IO adapter
    users, rooms, votes,       so several API instances share broadcasts)
    playlists, devices...)
        external: Deezer API (track search), Google (ID token check), SMTP (mailpit in dev)
```

The server is the source of truth. Every write goes through REST. The server
then broadcasts the **full new state** (ordered queue, full track list) over
Socket.IO, and clients replace their local copy with it. Concurrent votes and
moves are serialized server-side (row/advisory locks, atomic increments), so
everyone converges on the last committed state. Details: `Api/REALTIME.md`.

## Technical choices

| Choice | Why |
|---|---|
| **Node.js + Express** | One language (JS/TS) across API and app. Non-blocking I/O suits an API that mostly waits on the database and holds many idle sockets. Express is minimal and well known, and its middleware model fits auth, logging and rate limiting. Trade-off: one CPU core per process, so scaling out means more processes (supported via Redis) |
| **PostgreSQL + Prisma** | The data is relational (users, friendships, rooms, invites, votes, delegations) and must stay consistent under concurrency: unique constraints (one vote per user and track), transactions, row and advisory locks. Prisma gives a typed schema, `db push`/migrations and parameterized queries (no SQL injection) |
| **Redis** | In-memory and fast with a TTL: holds the access-token blacklist after logout. It is also the Pub/Sub backbone of the Socket.IO adapter, so broadcasts reach clients on any API instance |
| **REST** | Resources (rooms, tracks, votes, playlists, devices) map naturally to URLs and HTTP verbs. It is stateless (JWT), cacheable, easy to document with OpenAPI/Swagger and easy for third parties to use. GraphQL would add complexity without a real need here |
| **JSON** | Native to JS on both sides, readable when debugging, supported by every client and tool. More compact binary formats (protobuf...) are not needed at this scale |
| **Socket.IO** | Real time is required by the subject (votes, collaborative edits, remote control). Socket.IO adds handshake auth, acks, rooms/channels, automatic reconnection and a Redis adapter on top of WebSocket. Only subscriptions and delegation relays use it; writes stay on REST |
| **Expo / React Native** | One TypeScript codebase for Android and iOS, file-based routing (expo-router), ready-made modules (auth session for Google, audio, location for the geo license), fast iteration with Expo Go |
| **Docker Compose + Makefile** | One command brings up Postgres, Redis, mailpit, the API and Expo. Dependencies are downloaded, never committed |

## Repository

| Path | Content |
|---|---|
| `Api/` | Express API, Prisma schema (`prisma/schema.prisma`), tests (`test/`) |
| `App/` | Expo app (`app/` screens, `contexts/` auth, socket, audio, device player) |
| `load/` | k6 load tests (see `load/README.md`) |
| `docs/` | `SECURITY.md` (threat model), `LOAD_TESTING.md` (capacity), `task-split.md`, subject |
| `Api/REALTIME.md`, `Api/DEEZER.md` | Socket.IO contract, Deezer integration |

## Setup

Requirements: Docker with Compose, Node.js 20+ (24 is used in CI), make.

```sh
make env    # creates Api/.env from Api/.env.example with two random 64-char JWT secrets
```

Then edit `Api/.env`:
- **ports**: change `POSTGRES_PORT`, `REDIS_PORT`, `API_PORT`... if they are already
  taken (5432 often is). `make up` reads them;
- **Google sign-in**: `GOOGLE_CLIENT_ID*` (client ids from Google Cloud) and the same
  ids in `App/.env` (`cp App/.env.example App/.env`);
- **SMTP**: mailpit is used in development (UI at http://localhost:8025).

Secrets live only in the git-ignored `.env` files. `JWT_SECRET` and
`JWT_REFRESH_SECRET` must be at least 32 characters and different from each
other: the API refuses to start otherwise.

## Run

```sh
make up        # postgres, redis, mailpit, api (:3000), expo (:8081 / :19000)
make logs      # follow the logs
make down      # stop; `make fclean` also removes the volumes
```

The API container runs `prisma generate` and `prisma db push` at startup. To run
the API outside Docker: `cd Api && npm ci && npx prisma generate && npm run dev`
(using the host URLs from `Api/.env`).

Mobile: open the app with Expo Go (scan the QR code shown by `make logs`), or run
`cd App && npm ci && npx expo start`. The back-end address can be changed from
the login and profile screens (V.5).

## API documentation

Swagger UI: http://localhost:3000/api-docs (OpenAPI JSON: `/api-docs.json`).
Every route lists its inputs, outputs and error codes. The real-time contract
(events, payloads, acks, delegation commands) is in `Api/REALTIME.md`.

## Tests

```sh
make test-db   # once: pushes the schema to TEST_DATABASE_URL (that database is wiped by the tests)
make test      # API test suite (node:test): auth, OAuth, rooms, votes and concurrency,
               # playlists, realtime with and without Redis, devices, friends, delegation, security
cd App && npx tsc --noEmit   # app type check
```

CI (`.github/workflows/ci.yml`) runs on every push and pull request. It runs
the API tests against Postgres and Redis service containers (fresh random JWT
secrets for each run) and type-checks the app.

## Load tests

```sh
make load-api          # terminal 1: API on the test database
make load VUS=250      # terminal 2: seeds users, runs the 3 scenarios with k6 (Docker image if k6 is missing)
```

Measured capacity, machine specs and bottlenecks: `docs/LOAD_TESTING.md`. On
the reference desktop (16 cores, 30 GB, Postgres on an HDD), **250** very
active or **650** typical users run all three services at once with p95 < 500
ms and 0 % errors. On fast storage the same build reaches **1500** active
users.

## Security

See `docs/SECURITY.md`. It covers brute force, session theft, token replay,
Google token verification, enumeration, data isolation, spoofed geolocation,
flooding and socket abuse, injection, and the mandatory action logs (platform,
device, app version).
