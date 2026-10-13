#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.json"

if [ ! -f "${CONFIG_FILE}" ]; then
  echo "Génération de la configuration..."
  podman exec music-room_api_1 node src/scripts/setupBenchmark.js > /dev/null 2>&1 || true
fi

TOKEN=$(node -p 'require("./load-tests/config.json").accessToken' 2>/dev/null || echo "")

echo "=========================================================="
echo "   Music Room — Apache Benchmark (ab)"
echo "=========================================================="

echo ""
echo "--- Test 1 : Health Check (5000 requêtes, 100 concurrents) ---"
ab -k -n 5000 -c 100 -H "x-load-test: musicroom-benchmark" http://localhost:3000/health

echo ""
echo "--- Test 2 : Playlists publiques (2000 requêtes, 50 concurrents) ---"
ab -k -n 2000 -c 50 -H "x-load-test: musicroom-benchmark" http://localhost:3000/api/playlists

if [ -n "${TOKEN}" ]; then
  echo ""
  echo "--- Test 3 : Profil Utilisateur Authentifié (2000 requêtes, 50 concurrents) ---"
  ab -k -n 2000 -c 50 -H "Authorization: Bearer ${TOKEN}" -H "x-load-test: musicroom-benchmark" http://localhost:3000/api/users/me
fi

echo ""
echo "=========================================================="
echo "   Apache Benchmark terminé !"
echo "=========================================================="
