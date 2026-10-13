#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=========================================================="
echo "   Music Room — Lancement du Test de Charge k6"
echo "=========================================================="

# 1. Vérification / Initialisation des données de test
echo "[1/2] Préparation des données de test (utilisateurs & playlists)..."
if command -v podman &>/dev/null; then
  podman exec music-room_api_1 node src/scripts/setupBenchmark.js > /dev/null 2>&1 || true
elif command -v docker &>/dev/null; then
  docker exec music-room_api_1 node src/scripts/setupBenchmark.js > /dev/null 2>&1 || true
fi

# 2. Exécution de k6
echo "[2/2] Exécution du scénario k6 multi-services..."

K6_CMD=""
if command -v k6 &>/dev/null; then
  K6_CMD="k6 run"
  cd "${SCRIPT_DIR}"
  ${K6_CMD} "$@" k6-script.js
elif command -v podman &>/dev/null; then
  podman run --rm --net=host -v "${SCRIPT_DIR}:/tests:Z" -w /tests grafana/k6 run "$@" /tests/k6-script.js
elif command -v docker &>/dev/null; then
  docker run --rm --net=host -v "${SCRIPT_DIR}:/tests" -w /tests grafana/k6 run "$@" /tests/k6-script.js
else
  echo "Erreur : Ni k6, ni podman, ni docker ne sont disponibles pour exécuter k6."
  exit 1
fi

echo "=========================================================="
echo "   Test de Charge k6 terminé avec succès !"
echo "=========================================================="
