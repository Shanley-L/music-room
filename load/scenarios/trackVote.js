// Music Track Vote: join a room (REST + socket), read the queue, suggest tracks,
// vote / unvote, and check that the room's sockets receive `queue:updated`.

import { check } from 'k6';
import { setTimeout, setInterval, clearInterval } from 'k6/timers';
import { Trend, Rate, Counter } from 'k6/metrics';
import { connect } from '../lib/sio.js';
import { cfg, users, api, sioAuth, pick, think, uniqueId } from '../lib/common.js';

const S = 'vote';
const broadcastLatency = new Trend('vote_broadcast_latency', true);
const broadcastReceived = new Rate('vote_broadcast_received');
const queueUpdates = new Counter('vote_queue_updates_received');

/** Creates the shared rooms (setup): one per USERS_PER_ROOM voters, 10 tracks each. */
export function createRooms(count) {
  const rooms = [];
  for (let i = 0; i < count; i++) {
    const owner = users[i % users.length];
    const res = api('POST', '/api/rooms', owner.token, 'POST /rooms', S, { name: `load-room-${i}` });
    if (!check(res, { 'room created': (r) => r.status === 201 })) {
      throw new Error(`room creation failed: ${res.status} ${res.body}`);
    }
    const roomId = res.json('id');
    for (let t = 0; t < 10; t++) suggest(owner.token, roomId);
    rooms.push(roomId);
  }
  return rooms;
}

function suggest(token, roomId) {
  const res = api('POST', `/api/rooms/${roomId}/tracks`, token, 'POST /rooms/:id/tracks', S, {
    externalId: uniqueId('vt'),
    title: 'Load track',
    artist: 'k6',
  });
  check(res, { 'track suggested': (r) => r.status === 201 });
  return res;
}

export function trackVote(data) {
  const user = users[(__VU - 1) % users.length];
  const roomId = data.rooms[__VU % data.rooms.length];

  const room = api('GET', `/api/rooms/${roomId}`, user.token, 'GET /rooms/:id', S);
  check(room, { 'room read': (r) => r.status === 200 });

  // Write in flight: { id, startedAt, answered } until a queue:updated arrives after the response.
  let pending = null;
  let writeSeq = 0;
  let interval = null;

  const client = connect(cfg.baseUrl, sioAuth(user.token), {
    tags: { service: S },
    onConnect(sio) {
      sio.on('queue:updated', () => {
        queueUpdates.add(1);
        if (pending && pending.answered) {
          broadcastLatency.add(Date.now() - pending.startedAt);
          broadcastReceived.add(true);
          pending = null;
        }
      });

      sio.emit('room:join', { roomId }, (ack) => {
        check(ack, { 'room:join ok': (a) => a !== null && a.ok === true });
        if (!ack || !ack.ok) {
          sio.close();
          return;
        }
        interval = setInterval(() => act(), think());
      });
    },
  });

  function act() {
    const read = api('GET', `/api/rooms/${roomId}/tracks`, user.token, 'GET /rooms/:id/tracks', S);
    check(read, { 'queue read': (r) => r.status === 200 });
    if (read.status !== 200 || pending) return;

    const queue = read.json();
    const id = ++writeSeq;
    pending = { id, startedAt: Date.now(), answered: false };

    let res;
    if (queue.length === 0 || (queue.length < cfg.maxRoomTracks && Math.random() < 0.2)) {
      res = suggest(user.token, roomId);
    } else {
      const track = pick(queue);
      const path = `/api/rooms/${roomId}/tracks/${track.id}/vote`;
      res = track.hasVoted
        ? api('DELETE', path, user.token, 'DELETE /rooms/:id/tracks/:id/vote', S)
        : api('POST', path, user.token, 'POST /rooms/:id/tracks/:id/vote', S, {});
      check(res, { 'vote accepted': (r) => r.status === 200 });
    }

    if (res.status >= 300) {
      pending = null;
      return;
    }
    pending.answered = true;
    setTimeout(() => {
      if (pending && pending.id === id) {
        broadcastReceived.add(false);
        pending = null;
      }
    }, cfg.broadcastTimeoutMs);
  }

  setTimeout(() => {
    if (interval) clearInterval(interval);
    // Let the last broadcast arrive before leaving.
    setTimeout(() => client.close(), pending ? cfg.broadcastTimeoutMs : 0);
  }, cfg.sessionMs);
}
