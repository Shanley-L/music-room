// Music Playlist Editor: open a shared playlist (REST + socket), then cycle
// add a track -> move it -> remove it, and check that the playlist's sockets
// receive `playlist:tracks-updated`.

import { check } from 'k6';
import { setTimeout, setInterval, clearInterval } from 'k6/timers';
import { Trend, Rate, Counter } from 'k6/metrics';
import { connect } from '../lib/sio.js';
import { cfg, users, api, sioAuth, think, uniqueId } from '../lib/common.js';

const S = 'playlist';
const broadcastLatency = new Trend('playlist_broadcast_latency', true);
const broadcastReceived = new Rate('playlist_broadcast_received');
const tracksUpdates = new Counter('playlist_tracks_updates_received');

function addTrack(token, playlistId) {
  const res = api('POST', `/api/playlists/${playlistId}/tracks`, token, 'POST /playlists/:id/tracks', S, {
    externalId: uniqueId('pt'),
    title: 'Load track',
    artist: 'k6',
  });
  check(res, { 'playlist track added': (r) => r.status === 201 });
  return res;
}

/** Creates the shared playlists (setup): one per USERS_PER_PLAYLIST editors, 10 tracks each. */
export function createPlaylists(count) {
  const playlists = [];
  for (let i = 0; i < count; i++) {
    const owner = users[(users.length - 1 - i + users.length) % users.length];
    const res = api('POST', '/api/playlists', owner.token, 'POST /playlists', S, { name: `load-playlist-${i}` });
    if (!check(res, { 'playlist created': (r) => r.status === 201 })) {
      throw new Error(`playlist creation failed: ${res.status} ${res.body}`);
    }
    const playlistId = res.json('playlist.id');
    for (let t = 0; t < 10; t++) addTrack(owner.token, playlistId);
    playlists.push(playlistId);
  }
  return playlists;
}

export function playlistEditor(data) {
  const user = users[(__VU - 1) % users.length];
  const playlistId = data.playlists[__VU % data.playlists.length];

  let pending = null;
  let writeSeq = 0;
  let interval = null;
  let step = 0;
  let myTrackId = null;

  const client = connect(cfg.baseUrl, sioAuth(user.token), {
    tags: { service: S },
    onConnect(sio) {
      sio.on('playlist:tracks-updated', () => {
        tracksUpdates.add(1);
        if (pending && pending.answered) {
          broadcastLatency.add(Date.now() - pending.startedAt);
          broadcastReceived.add(true);
          pending = null;
        }
      });

      sio.emit('playlist:join', { playlistId }, (ack) => {
        check(ack, { 'playlist:join ok': (a) => a !== null && a.ok === true });
        if (!ack || !ack.ok) {
          sio.close();
          return;
        }
        interval = setInterval(() => act(), think());
      });
    },
  });

  function act() {
    if (pending) return;

    let res;
    const id = ++writeSeq;
    if (step === 0 || !myTrackId) {
      pending = { id, startedAt: Date.now(), answered: false };
      res = addTrack(user.token, playlistId);
      if (res.status === 201) myTrackId = res.json('track.id');
      step = 1;
    } else if (step === 1) {
      // Read the current order, then move our track to a random position.
      const read = api('GET', `/api/playlists/${playlistId}`, user.token, 'GET /playlists/:id', S);
      check(read, { 'playlist read': (r) => r.status === 200 });
      if (read.status !== 200) return;
      const ids = read.json('playlist.tracks').map((t) => t.id).filter((t) => t !== myTrackId);
      ids.splice(Math.floor(Math.random() * (ids.length + 1)), 0, myTrackId);
      pending = { id, startedAt: Date.now(), answered: false };
      res = api('PUT', `/api/playlists/${playlistId}/tracks/reorder`, user.token, 'PUT /playlists/:id/tracks/reorder', S, {
        trackIds: ids,
      });
      check(res, { 'playlist reordered': (r) => r.status === 200 });
      step = 2;
    } else {
      pending = { id, startedAt: Date.now(), answered: false };
      res = api('DELETE', `/api/playlists/${playlistId}/tracks/${myTrackId}`, user.token, 'DELETE /playlists/:id/tracks/:id', S);
      check(res, { 'playlist track removed': (r) => r.status === 200 });
      myTrackId = null;
      step = 0;
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
    // Leave the playlist as we found it: remove the track we may still own.
    if (myTrackId) {
      api('DELETE', `/api/playlists/${playlistId}/tracks/${myTrackId}`, user.token, 'DELETE /playlists/:id/tracks/:id', S);
    }
    setTimeout(() => client.close(), pending ? cfg.broadcastTimeoutMs : 0);
  }, cfg.sessionMs);
}
