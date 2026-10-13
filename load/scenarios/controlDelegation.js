// Music Control Delegation: one VU = an owner's player device + a delegated friend.
// The player registers its device over Socket.IO, the friend watches it and sends
// commands; the server checks the per-device license and relays each command to the
// player, which answers with its state; the friend measures the round trip.

import { check } from 'k6';
import { setTimeout, setInterval, clearInterval } from 'k6/timers';
import { Trend, Rate } from 'k6/metrics';
import { connect } from '../lib/sio.js';
import { cfg, pairs, api, sioAuth, think } from '../lib/common.js';

const S = 'delegation';
const roundTrip = new Trend('delegation_roundtrip', true);
const roundTripOk = new Rate('delegation_roundtrip_ok');

const COMMANDS = [
  { command: 'play' },
  { command: 'setVolume', value: 40 },
  { command: 'next' },
  { command: 'pause' },
];

export function controlDelegation() {
  const pair = pairs[(__VU - 1) % pairs.length];
  const { deviceId } = pair;

  const devices = api('GET', '/api/devices', pair.owner.token, 'GET /devices', S);
  check(devices, { 'devices listed': (r) => r.status === 200 });
  const received = api('GET', '/api/delegations/received', pair.friend.token, 'GET /delegations/received', S);
  check(received, { 'delegations listed': (r) => r.status === 200 });

  let playerReady = false;
  let remoteReady = false;
  let interval = null;
  let pending = null; // { id, sentAt }
  let seq = 0;
  let state = { playing: false, volume: 50, track: 0 };

  const player = connect(cfg.baseUrl, sioAuth(pair.owner.token), {
    tags: { service: S, role: 'player' },
    onConnect(sio) {
      // Execute relayed commands locally, then publish the new state.
      sio.on('device:command', (cmd) => {
        if (cmd.command === 'play') state.playing = true;
        else if (cmd.command === 'pause') state.playing = false;
        else if (cmd.command === 'next') state.track += 1;
        else if (cmd.command === 'setVolume') state.volume = cmd.value;
        sio.emit('device:state', { deviceId, state }, (ack) => {
          check(ack, { 'device:state ok': (a) => a !== null && a.ok === true });
        });
      });
      sio.emit('device:register', { deviceId }, (ack) => {
        check(ack, { 'device:register ok': (a) => a !== null && a.ok === true });
        playerReady = Boolean(ack && ack.ok);
        start();
      });
    },
  });

  const remote = connect(cfg.baseUrl, sioAuth(pair.friend.token), {
    tags: { service: S, role: 'remote' },
    onConnect(sio) {
      sio.on('device:state', () => {
        if (pending) {
          roundTrip.add(Date.now() - pending.sentAt);
          roundTripOk.add(true);
          pending = null;
        }
      });
      sio.emit('device:watch', { deviceId }, (ack) => {
        check(ack, { 'device:watch ok': (a) => a !== null && a.ok === true });
        remoteReady = Boolean(ack && ack.ok);
        start();
      });
    },
  });

  function start() {
    if (!playerReady || !remoteReady || interval) return;
    interval = setInterval(() => sendCommand(), think());
  }

  function sendCommand() {
    if (pending) return;
    const id = ++seq;
    const { command, value } = COMMANDS[id % COMMANDS.length];
    pending = { id, sentAt: Date.now() };
    remote.emit('device:command', { deviceId, command, value }, (ack) => {
      check(ack, { 'device:command ok': (a) => a !== null && a.ok === true });
      if (!ack || !ack.ok) {
        if (pending && pending.id === id) {
          roundTripOk.add(false);
          pending = null;
        }
      }
    });
    setTimeout(() => {
      if (pending && pending.id === id) {
        roundTripOk.add(false);
        pending = null;
      }
    }, cfg.broadcastTimeoutMs);
  }

  setTimeout(() => {
    if (interval) clearInterval(interval);
    setTimeout(() => {
      remote.close();
      player.close();
    }, pending ? cfg.broadcastTimeoutMs : 0);
  }, cfg.sessionMs);
}
