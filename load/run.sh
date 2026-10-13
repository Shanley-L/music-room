#!/bin/sh
# Seeds the load users (test database only) and runs load/main.js with k6.
# Uses a local k6 binary when installed, otherwise the grafana/k6 Docker image.
# The API must already be running at BASE_URL (see `make load-api`).
#
#   VUS=500 ./load/run.sh          # or: make load VUS=500
#   SKIP_SEED=1 VUS=500 ./load/run.sh
set -eu

cd "$(dirname "$0")"

VUS="${VUS:-100}"
export VUS
export BASE_URL="${BASE_URL:-http://localhost:3000}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:latest}"

if [ -z "${SKIP_SEED:-}" ]; then
  # 80% of the users hold one seeded account each, 10% are owner/friend pairs.
  node seed.js "$VUS" "$((VUS / 10 + 1))"
fi

mkdir -p results

if ! curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then
  echo "API not reachable at $BASE_URL/health: start it first (make load-api)." >&2
  exit 1
fi

VARS="BASE_URL VUS RAMP HOLD SESSION_S THINK_MS USERS_PER_ROOM USERS_PER_PLAYLIST MAX_ROOM_TRACKS P95_MS BROADCAST_TIMEOUT_MS SUMMARY_FILE"

if command -v k6 >/dev/null 2>&1; then
  exec k6 run main.js
fi

echo "k6 not installed: using the $K6_IMAGE Docker image" >&2
ENV_ARGS=""
for v in $VARS; do
  eval "isset=\${$v+x}"
  [ -n "$isset" ] && ENV_ARGS="$ENV_ARGS -e $v"
done
# shellcheck disable=SC2086
exec docker run --rm -i --network host -u "$(id -u):$(id -g)" \
  -v "$PWD:/load" -w /load $ENV_ARGS "$K6_IMAGE" run main.js
