# Music Room – Load testing (subject V.7)

This page answers the subject's V.7 requirement: how many users can use the
three services at the same time, measured on a stated machine. Every number
below comes from k6 runs executed on **2026-10-13**. The small JSON summaries
are in `load/results/`. How to run the tests: `load/README.md`.

## Machine (on premise, one host for everything)

| Item | Value |
|---|---|
| CPU | 16 logical cores (`nproc` = 16) |
| RAM | 30 GB |
| Disk | `/` and Docker volumes on a 1 TB **7200 rpm HDD** (Toshiba HDWD110). `pg_test_fsync` measured about **88 fdatasync/s** (11 ms per sync) |
| OS | Linux 7.0 (desktop, not a dedicated server) |
| Node.js | v24.14.1 |
| Postgres | 16-alpine (Docker), default settings (`max_connections` 100, `shared_buffers` 128 MB, `synchronous_commit` on) |
| Redis | 7-alpine (Docker); the Socket.IO Redis adapter was active |
| Load generator | k6 v2.3.0 (`grafana/k6` Docker image, `--network host`) |

The API (one Node process, `NODE_ENV=production`), Postgres, Redis and k6 all
ran on this same host. That makes the results pessimistic: k6 used up to 2.5
cores and competed with the API for CPU.

## Method

`load/main.js` runs three k6 scenarios **at the same time**. Each virtual user
is a seeded account with its own JWT (`load/seed.js`, test database only). A VU
iteration is one app session, `SESSION_S` = 60 s long: open a Socket.IO
connection, subscribe, act every `THINK_MS` (±25 % jitter), then disconnect.

| Service | Share of users | What each user does |
|---|---|---|
| Track Vote | 40 % | `GET /rooms/:id`, socket `room:join`. Every tick: read the queue (`GET /rooms/:id/tracks`), then suggest a track (20 %, up to 30 per room) or vote/unvote a random track. 25 users per room; rooms are created through REST in `setup()` |
| Playlist Editor | 40 % | Socket `playlist:join`. Every tick, in a cycle: add a track, read and move it (`PUT /tracks/reorder`), remove it. 10 editors per playlist |
| Control Delegation | 20 % (pairs) | Each VU is an owner device plus the friend it is delegated to, so 2 users and 2 sockets. Player: `device:register`, runs each relayed `device:command` and answers with `device:state`. Friend: `GET /delegations/received`, `device:watch`, then sends play / volume / next / pause |

Users ramp up for 1 min, hold for 2 min, then ramp down. The rate limits were
raised for the single load IP through the existing env overrides only
(`RATE_LIMIT_API_MAX`, `RATE_LIMIT_VOTE_MAX`, see `make load-api`). The API code
was not changed.

**Pass criteria** (the k6 thresholds; a failure makes k6 exit non-zero):
- HTTP error rate < 1 % and HTTP p95 < **500 ms**, overall and per service;
- checks > 99 %, Socket.IO connections > 99 %;
- more than 99 % of our own writes come back as a broadcast on our socket
  (`queue:updated` / `playlist:tracks-updated`), and more than 99 % of delegation
  commands complete a round trip;
- p95 < 1 s for write-to-broadcast latency and for delegation round trips.

"Write-to-broadcast latency" runs from the moment a user sends a REST write
until the same user's socket has processed the next broadcast. "Delegation
round trip" runs from `device:command` (friend) to the relay (player), then
`device:state`, until the state reaches the friend.

## Results

### A. Reference stack (Postgres on the HDD), active profile (`THINK_MS`=3000)

| Simulated users | HTTP req/s | HTTP p95 (vote / playlist / delegation) | Errors | Vote broadcast p95 | Playlist broadcast p95 | Delegation round trip p95 | Result |
|---|---|---|---|---|---|---|---|
| 200 (run 1) | 62 | 145 ms overall | 0 % | 158 ms | 166 ms | 163 ms | PASS |
| 200 (run 2) | 61 | 283 / 229 / 75 ms | 0 % | – | – | – | PASS |
| **250** | 77 | 221 / 163 / 165 ms | 0 % | – | – | – | **PASS** |
| 300 | 90 | 524 / 319 / 331 ms | 0 % | – | – | – | FAIL (vote p95) |
| 400 | 119 | 544 / 304 / 361 ms | 0 % | 449 ms | 319 ms | 613 ms | FAIL (vote p95) |
| 500 | 129 | 1251 / 732 / 1131 ms | 0 % | 1010 ms | 747 ms | 1598 ms | FAIL |

### B. Reference stack, realistic profile (`THINK_MS`=10000)

| Simulated users | HTTP req/s | HTTP p95 (vote / playlist / delegation) | Errors | Vote / playlist broadcast p95 | Delegation p95 | Result |
|---|---|---|---|---|---|---|
| 500 | 50 | 442 / 363 / 293 ms | 0 % | 308 / 490 ms | 509 ms | PASS |
| **650** | 64 | 312 / 264 / 327 ms | 0 % | 293 / 295 ms | 346 ms | **PASS** |
| 800 | 78 | 852 / 535 / 404 ms | 0 % | 717 / 602 ms | 1060 ms | FAIL |

### C. Same API, Postgres data on tmpfs (RAM), active profile

This run removes the disk bottleneck, to find the next one. A temporary
Postgres container kept its data on tmpfs, so it had no durability. It stands
for "fast storage", an upper bound for an SSD or NVMe server. It is **not** a
configuration to deploy.

| Simulated users | HTTP req/s | HTTP p95 (vote / playlist / delegation) | Errors | Vote / playlist broadcast p95 | Delegation p95 | API CPU | Result |
|---|---|---|---|---|---|---|---|
| 600 | 191 | 6 / 7 / 3 ms | 0 % | 9 / 8 ms | 4 ms | ~50 % | PASS |
| 1000 | 318 | 11 / 13 / 4 ms | 0 % | 16 / 16 ms | 9 ms | ~75 % | PASS |
| **1500** | 470 | 54 / 41 / 34 ms | 0 % | 59 / 48 ms | 56 ms | ~105 % | **PASS** |
| 1750 | 488 | 547 / 291 / 540 ms | 0.001 % | 443 / 302 ms | 572 ms | ~123 % | FAIL (p95) |
| 2000 | 494 | 977 / 517 / 973 ms | 0.001 % | 771 / 525 ms | 1003 ms | ~116 % | FAIL |

At every load level, all Socket.IO connections and channel joins succeeded. At
least 99 % of broadcasts and delegation round trips arrived; only the latency
thresholds failed. The single failed request at 1750 and 2000 users never got
an HTTP response on the k6 side, and the API logged no 4xx or 5xx.

## Bottlenecks observed

1. **Disk commits (reference stack).** During the 400-user run, `pg_stat_activity`
   showed all 10 Prisma pool connections waiting on `LWLock:WALWrite` /
   `IO:WALSync`. API CPU stayed at about 30 %. Each HTTP request and each
   socket event commits a `SystemLog` row (logging required by subject V.6) on
   top of the write itself, and the HDD syncs about 90 times per second. The
   load is therefore limited by commits per second, not by CPU.
2. **Prisma / `pg` pool of 10 connections** (the `pg.Pool` default in
   `src/lib/prisma.js`). The size cannot be set through the environment, so it
   caps database concurrency and makes lock and fsync waits queue up.
3. **One Node.js event loop (fast storage).** At 1750 users and more, the API
   process uses about 120 % CPU (main thread saturated, plus GC and libuv) at
   about 490 req/s and about 2000 socket messages/s. Latency rises for every
   service together.
4. **Track Vote is the most expensive service.** Every vote takes a per-room
   lock and re-reads the whole queue for `queue:updated`. With 25 users in a
   room, one write fans out to 25 sockets. Vote p95 always crosses the limit
   first.

None of these runs exposed a functional bug: no 5xx, no lost broadcasts, no
delegation refused by mistake.

## Supported users

| Deployment | Supported concurrent users (all 3 services) |
|---|---|
| This desktop, Postgres on a 7200 rpm HDD, active users (one write every 3 s) | **250** |
| This desktop, Postgres on a 7200 rpm HDD, typical users (one write every 10 s) | **650** |
| Same CPU, fast storage (tmpfs, upper bound for an SSD server), active users | **1500** |

The headline figure is **250 users** acting together, each writing every 3
seconds. That is the run that passed every threshold on the reference
hardware: p95 < 500 ms, 0 % errors, more than 99 % of broadcasts delivered.
With more typical usage (a vote or an edit every 10 s) the same machine holds
**650 users**.

This is consistent with the platform. The machine is a desktop whose database
sits on a spinning disk, and one Node process uses one core. "Hundreds" of
users matches the subject's scale ("dozens for a Raspberry, thousands for a
low-end server"). With SSD-class storage, the same code reaches about **1500**
active users on one core, which is the "thousands for a low-end server" range.

Ways to scale further (not done here, because they would change the API):
- a configurable pool size;
- batching or async shipping of `SystemLog`;
- several API instances behind a load balancer. Socket.IO already syncs
  instances through the Redis adapter. The rate-limiter counters would need a
  shared Redis store (see `docs/SECURITY.md` §8).
