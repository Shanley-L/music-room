// Load test: the three Music Room services run concurrently with ramping users.
// See load/README.md. Example:
//   VUS=500 k6 run load/main.js
//
// Env: BASE_URL, VUS (simulated users at the plateau), RAMP, HOLD, SESSION_S,
// THINK_MS, USERS_PER_ROOM, USERS_PER_PLAYLIST, P95_MS, SUMMARY_FILE.

import { cfg, split, users, pairs } from './lib/common.js';
import { createRooms } from './scenarios/trackVote.js';
import { createPlaylists } from './scenarios/playlistEditor.js';

export { trackVote } from './scenarios/trackVote.js';
export { playlistEditor } from './scenarios/playlistEditor.js';
export { controlDelegation } from './scenarios/controlDelegation.js';

function ramping(exec, target) {
  return {
    executor: 'ramping-vus',
    exec,
    startVUs: 0,
    stages: [
      { duration: cfg.ramp, target },
      { duration: cfg.hold, target },
      { duration: '20s', target: 0 },
    ],
    // A session is SESSION_S long; let running sessions finish when ramping down.
    gracefulRampDown: `${Math.ceil(cfg.sessionMs / 1000) + 10}s`,
    gracefulStop: `${Math.ceil(cfg.sessionMs / 1000) + 10}s`,
  };
}

export const options = {
  setupTimeout: '10m',
  scenarios: {
    track_vote: ramping('trackVote', split.vote),
    playlist_editor: ramping('playlistEditor', split.playlist),
    control_delegation: ramping('controlDelegation', split.delegation),
  },
  thresholds: {
    // Pass criteria of a run (see docs/LOAD_TESTING.md).
    http_req_failed: ['rate<0.01'],
    http_req_duration: [`p(95)<${cfg.p95Ms}`],
    checks: ['rate>0.99'],
    sio_connect_ok: ['rate>0.99'],
    vote_broadcast_received: ['rate>0.99'],
    playlist_broadcast_received: ['rate>0.99'],
    delegation_roundtrip_ok: ['rate>0.99'],
    vote_broadcast_latency: [`p(95)<${cfg.p95Ms * 2}`],
    playlist_broadcast_latency: [`p(95)<${cfg.p95Ms * 2}`],
    delegation_roundtrip: [`p(95)<${cfg.p95Ms * 2}`],
    // Per-service breakdown (reported in the summary).
    'http_req_duration{service:vote}': [`p(95)<${cfg.p95Ms}`],
    'http_req_duration{service:playlist}': [`p(95)<${cfg.p95Ms}`],
    'http_req_duration{service:delegation}': [`p(95)<${cfg.p95Ms}`],
    'http_req_failed{service:vote}': ['rate<0.01'],
    'http_req_failed{service:playlist}': ['rate<0.01'],
    'http_req_failed{service:delegation}': ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const needUsers = split.vote + split.playlist;
  if (users.length < needUsers) {
    throw new Error(`load/.tokens.json has ${users.length} users, ${needUsers} needed: re-run node load/seed.js`);
  }
  if (pairs.length < split.delegation) {
    throw new Error(`load/.tokens.json has ${pairs.length} pairs, ${split.delegation} needed: re-run node load/seed.js`);
  }
  return {
    rooms: createRooms(Math.ceil(split.vote / cfg.usersPerRoom)),
    playlists: createPlaylists(Math.ceil(split.playlist / cfg.usersPerPlaylist)),
  };
}

const REPORTED = [
  'http_reqs',
  'http_req_failed',
  'http_req_duration',
  'http_req_duration{service:vote}',
  'http_req_duration{service:playlist}',
  'http_req_duration{service:delegation}',
  'http_req_failed{service:vote}',
  'http_req_failed{service:playlist}',
  'http_req_failed{service:delegation}',
  'checks',
  'sio_connect_ok',
  'sio_connect_time',
  'sio_ack_ok',
  'sio_ack_time',
  'sio_unexpected_close',
  'vote_broadcast_received',
  'vote_broadcast_latency',
  'vote_queue_updates_received',
  'playlist_broadcast_received',
  'playlist_broadcast_latency',
  'playlist_tracks_updates_received',
  'delegation_roundtrip_ok',
  'delegation_roundtrip',
  'ws_msgs_received',
  'ws_msgs_sent',
  'ws_sessions',
  'vus_max',
];

function fmt(name, m) {
  const v = m.values;
  if (m.type === 'trend') {
    return `p50=${v.med.toFixed(1)}ms p95=${v['p(95)'].toFixed(1)}ms p99=${v['p(99)'].toFixed(1)}ms max=${v.max.toFixed(1)}ms`;
  }
  if (m.type === 'rate') return `${(v.rate * 100).toFixed(3)}%  (${v.passes} / ${v.passes + v.fails})`;
  if (m.type === 'counter') return `${v.count}  (${v.rate.toFixed(1)}/s)`;
  return `${v.value ?? v.max}`;
}

export function handleSummary(data) {
  const summary = {
    date: new Date().toISOString(),
    params: {
      baseUrl: cfg.baseUrl,
      simulatedUsers: split.total,
      vus: { trackVote: split.vote, playlistEditor: split.playlist, controlDelegation: split.delegation },
      ramp: cfg.ramp,
      hold: cfg.hold,
      sessionS: cfg.sessionMs / 1000,
      thinkMs: cfg.thinkMs,
      usersPerRoom: cfg.usersPerRoom,
      usersPerPlaylist: cfg.usersPerPlaylist,
      p95Ms: cfg.p95Ms,
    },
    thresholdsPassed: true,
    metrics: {},
  };

  const lines = [
    '',
    `Music Room load test: ${split.total} simulated users ` +
      `(vote ${split.vote}, playlist ${split.playlist}, delegation ${split.delegation} pairs)`,
    '',
  ];
  for (const name of REPORTED) {
    const m = data.metrics[name];
    if (!m) continue;
    const thresholds = m.thresholds || {};
    const failed = Object.keys(thresholds).filter((t) => !thresholds[t].ok);
    // A rate with no sample means the scenario never got that far: count it as a failure.
    if (m.type === 'rate' && Object.keys(thresholds).length && m.values.passes + m.values.fails === 0) {
      failed.push('no data');
    }
    if (failed.length) summary.thresholdsPassed = false;
    const mark = Object.keys(thresholds).length ? (failed.length ? 'FAIL' : 'ok  ') : '    ';
    lines.push(`${mark} ${name.padEnd(40)} ${fmt(name, m)}${failed.length ? `  [${failed.join(', ')}]` : ''}`);
    summary.metrics[name] = { ...m.values, thresholds };
  }
  // Thresholds on metrics not listed above.
  for (const [name, m] of Object.entries(data.metrics)) {
    if (REPORTED.includes(name) || !m.thresholds) continue;
    if (Object.values(m.thresholds).some((t) => !t.ok)) summary.thresholdsPassed = false;
  }
  lines.push('', `Thresholds: ${summary.thresholdsPassed ? 'PASSED' : 'FAILED'}`, '');

  const out = { stdout: lines.join('\n') };
  const file = __ENV.SUMMARY_FILE || `results/summary-${split.total}.json`;
  out[file] = JSON.stringify(summary, null, 2);
  return out;
}
