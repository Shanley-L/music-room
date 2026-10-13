# Load tests (k6)

These scripts drive the three services at the same time: Track Vote, Playlist
Editor and Control Delegation. Each scenario uses REST and Socket.IO together.
Method and measured results: `docs/LOAD_TESTING.md`.

| File | Role |
|---|---|
| `seed.js` | Writes N users and N/10+1 owner/friend/device/delegation pairs straight into `TEST_DATABASE_URL`, then saves their JWTs to `.tokens.json` (git-ignored). It **wipes the test database** first and refuses to run without `TEST_DATABASE_URL` or with `NODE_ENV=production` |
| `main.js` | k6 entry point: three `ramping-vus` scenarios, thresholds, and a summary in `results/summary-<users>.json` |
| `scenarios/*.js` | One file per service |
| `lib/sio.js` | Minimal Socket.IO v4 client (Engine.IO framing over `k6/websockets`) |
| `run.sh` | Seed + k6 (local binary, or the `grafana/k6` Docker image when k6 is missing) |

## Run

You need Postgres (with the schema pushed to the test database: `make test-db`)
and Redis, for example from `make up`, plus `Api/.env`.

```sh
# Terminal 1: API on the test database, production mode, rate limits raised for one IP
make load-api            # logs go to load/results/api.log

# Terminal 2
make load VUS=250        # = VUS=250 ./load/run.sh
make load-clean          # wipes the load data from the test database
```

k6 exits non-zero (code 99) when a threshold fails.

## Parameters (environment)

| Variable | Default | Meaning |
|---|---|---|
| `VUS` | 100 | Simulated users at the plateau: 40 % vote, 40 % playlist, 20 % delegation (pairs of 2) |
| `BASE_URL` | `http://localhost:3000` | API under test |
| `RAMP` / `HOLD` | `1m` / `2m` | Ramp-up and plateau durations |
| `SESSION_S` | 60 | Length of one app session (socket connect -> disconnect) |
| `THINK_MS` | 3000 | Pause between two actions of a user (±25 %) |
| `USERS_PER_ROOM` / `USERS_PER_PLAYLIST` | 25 / 10 | Users sharing one room / one playlist |
| `P95_MS` | 500 | HTTP p95 threshold (broadcast and round-trip thresholds are twice this) |
| `SKIP_SEED` | unset | Reuse the existing `.tokens.json` |
| `SUMMARY_FILE` | `results/summary-<users>.json` | Summary path, relative to `load/` |
