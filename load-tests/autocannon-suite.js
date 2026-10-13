import autocannon from 'autocannon';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = JSON.parse(readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const BASE_URL = config.apiUrl || 'http://localhost:3000';

const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'MusicRoom-Autocannon/1.0',
  'x-load-test': 'musicroom-benchmark',
};

const AUTH_HEADERS = {
  ...COMMON_HEADERS,
  'Authorization': `Bearer ${config.accessToken}`,
};

async function runBenchmark(name, options) {
  console.log(`\n==========================================================`);
  console.log(`  Lancement du Benchmark : ${name}`);
  console.log(`  Durée: ${options.duration || 10}s | Concurrence: ${options.connections || 50} connexions`);
  console.log(`==========================================================`);

  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: options.url,
        connections: options.connections || 50,
        duration: options.duration || 10,
        pipelining: options.pipelining || 1,
        headers: options.headers || COMMON_HEADERS,
        method: options.method || 'GET',
        body: options.body,
        title: name,
      },
      (err, result) => {
        if (err) return reject(err);
        console.log(autocannon.printResult(result, { renderResultsTable: true }));
        resolve(result);
      }
    );
  });
}

async function main() {
  console.log('--- Music Room : Suite de Benchmarks Autocannon (3 Services) ---');

  // 1. Service 1 : Auth / Profil
  await runBenchmark('Service 1: GET /api/users/me (Profil Authentifié)', {
    url: `${BASE_URL}/api/users/me`,
    connections: 50,
    duration: 10,
    headers: AUTH_HEADERS,
  });

  // 2. Service 2 : Playlist Editor
  await runBenchmark('Service 2: GET /api/playlists (Playlists Publiques)', {
    url: `${BASE_URL}/api/playlists`,
    connections: 50,
    duration: 10,
    headers: COMMON_HEADERS,
  });

  // 3. Service 3 : Rooms / Deezer Search
  await runBenchmark('Service 3: GET /api/rooms/public (Salles Publiques)', {
    url: `${BASE_URL}/api/rooms/public`,
    connections: 50,
    duration: 10,
    headers: AUTH_HEADERS,
  });

  console.log('\n Tous les tests de charge Autocannon se sont achevés avec succès.');
}

main().catch((err) => {
  console.error('Erreur durant le benchmark:', err);
  process.exit(1);
});
