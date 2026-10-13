import http from 'k6/http';
import { SharedArray } from 'k6/data';

function envInt(name, fallback) {
  const n = Number.parseInt(__ENV[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const cfg = {
  baseUrl: (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Total simulated users at the plateau, split across the three services.
  users: envInt('VUS', 100),
  ramp: __ENV.RAMP || '1m',
  hold: __ENV.HOLD || '2m',
  // One VU iteration = one app session: connect, subscribe, act every THINK_MS, leave.
  sessionMs: envInt('SESSION_S', 60) * 1000,
  thinkMs: envInt('THINK_MS', 3000),
  usersPerRoom: envInt('USERS_PER_ROOM', 25),
  usersPerPlaylist: envInt('USERS_PER_PLAYLIST', 10),
  maxRoomTracks: envInt('MAX_ROOM_TRACKS', 30),
  p95Ms: envInt('P95_MS', 500),
  broadcastTimeoutMs: envInt('BROADCAST_TIMEOUT_MS', 5000),
};

// Split of the simulated users: 40% Track Vote, 40% Playlist Editor,
// 20% Control Delegation (one VU there = owner device + delegated friend = 2 users).
export const split = {
  vote: Math.max(1, Math.round(cfg.users * 0.4)),
  playlist: Math.max(1, Math.round(cfg.users * 0.4)),
  delegation: Math.max(1, Math.round((cfg.users * 0.2) / 2)),
};
split.total = split.vote + split.playlist + split.delegation * 2;

// Written by `node load/seed.js` (git-ignored).
const TOKENS = import.meta.resolve('../.tokens.json');
export const users = new SharedArray('users', () => JSON.parse(open(TOKENS)).users);
export const pairs = new SharedArray('pairs', () => JSON.parse(open(TOKENS)).pairs);

export function params(token, name, service) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Platform': 'k6',
      'X-Device': 'load-test',
      'X-App-Version': 'load',
    },
    tags: { name, service },
  };
}

export function sioAuth(token) {
  return { token, platform: 'k6', device: 'load-test', appVersion: 'load' };
}

export function api(method, path, token, name, service, body) {
  const p = params(token, name, service);
  const url = `${cfg.baseUrl}${path}`;
  return http.request(method, url, body === undefined ? null : JSON.stringify(body), p);
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Think time with +/-25% jitter so users do not act in lockstep. */
export function think() {
  return Math.round(cfg.thinkMs * (0.75 + Math.random() * 0.5));
}

let counter = 0;
export function uniqueId(prefix) {
  counter += 1;
  // __VU is 0 and __ITER undefined in setup().
  const iter = typeof __ITER === 'undefined' ? 's' : __ITER;
  return `${prefix}-${__VU}-${iter}-${counter}-${Date.now()}`;
}
