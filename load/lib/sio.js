// Minimal Socket.IO v4 client for k6 (Engine.IO v4 over a raw WebSocket).
//
// Frames used (see Api/REALTIME.md for the events):
//   server "0{...}"           engine.io open          -> client sends "40{auth}"
//   server "40{sid}"          namespace connected     -> onConnect()
//   server "44{message}"      connect error (e.g. UNAUTHORIZED)
//   server "2"                ping                    -> client answers "3"
//   client "42<id>[ev,data]"  emit with ack id        <- server "43<id>[ack]"
//   server "42[ev,data]"      broadcast event

import { WebSocket } from 'k6/websockets';
import { setTimeout, clearTimeout } from 'k6/timers';
import { Rate, Trend, Counter } from 'k6/metrics';

export const sioConnectOk = new Rate('sio_connect_ok');
export const sioConnectTime = new Trend('sio_connect_time', true);
export const sioAckOk = new Rate('sio_ack_ok');
export const sioAckTime = new Trend('sio_ack_time', true);
export const sioUnexpectedClose = new Counter('sio_unexpected_close');

const ACK_TIMEOUT_MS = 5000;

export function wsUrl(baseUrl) {
  return `${baseUrl.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
}

/**
 * Opens a Socket.IO connection. `onConnect(client)` runs once the namespace
 * handshake succeeds; `client.on(event, fn)` registers broadcast handlers.
 */
export function connect(baseUrl, auth, { onConnect, tags = {} } = {}) {
  const ws = new WebSocket(wsUrl(baseUrl));
  const handlers = {};
  const pendingAcks = {};
  let nextAckId = 0;
  let connected = false;
  let closing = false;
  const openedAt = Date.now();

  const client = {
    on(event, fn) {
      handlers[event] = fn;
    },
    /** Emits `event`; `cb(ack)` receives the server ack, or `null` on timeout. */
    emit(event, payload, cb) {
      if (!connected) {
        if (cb) cb(null);
        return;
      }
      if (!cb) {
        ws.send(`42${JSON.stringify([event, payload])}`);
        return;
      }
      const id = nextAckId++;
      const sentAt = Date.now();
      const timer = setTimeout(() => {
        delete pendingAcks[id];
        sioAckOk.add(false, { event, ...tags });
        cb(null);
      }, ACK_TIMEOUT_MS);
      pendingAcks[id] = {
        timer,
        fn(ack) {
          clearTimeout(timer);
          sioAckTime.add(Date.now() - sentAt, { event, ...tags });
          sioAckOk.add(Boolean(ack && ack.ok), { event, ...tags });
          cb(ack);
        },
      };
      ws.send(`42${id}${JSON.stringify([event, payload])}`);
    },
    close() {
      closing = true;
      for (const id of Object.keys(pendingAcks)) {
        clearTimeout(pendingAcks[id].timer);
        delete pendingAcks[id];
      }
      try {
        ws.send('41');
      } catch (_) {
        // already closed
      }
      ws.close();
    },
    get connected() {
      return connected;
    },
  };

  ws.onmessage = (e) => {
    const msg = String(e.data);
    const type = msg[0];
    if (type === '2') {
      ws.send('3');
      return;
    }
    if (type === '0') {
      ws.send(`40${JSON.stringify(auth)}`);
      return;
    }
    if (type !== '4') return;

    const packet = msg[1];
    const body = msg.slice(2);
    if (packet === '0') {
      connected = true;
      sioConnectOk.add(true, tags);
      sioConnectTime.add(Date.now() - openedAt, tags);
      if (onConnect) onConnect(client);
    } else if (packet === '4') {
      sioConnectOk.add(false, tags);
      closing = true;
      ws.close();
    } else if (packet === '1') {
      // server-side disconnect of the namespace
      connected = false;
      if (!closing) sioUnexpectedClose.add(1, tags);
    } else if (packet === '2') {
      const [event, data] = JSON.parse(body);
      if (handlers[event]) handlers[event](data);
    } else if (packet === '3') {
      const bracket = body.indexOf('[');
      const id = Number(body.slice(0, bracket));
      const args = JSON.parse(body.slice(bracket));
      if (pendingAcks[id]) {
        const pending = pendingAcks[id];
        delete pendingAcks[id];
        pending.fn(args[0]);
      }
    }
  };

  ws.onerror = () => {
    if (!connected) sioConnectOk.add(false, tags);
  };

  ws.onclose = () => {
    for (const id of Object.keys(pendingAcks)) {
      clearTimeout(pendingAcks[id].timer);
      delete pendingAcks[id];
    }
    if (!closing && connected) sioUnexpectedClose.add(1, tags);
    connected = false;
  };

  return client;
}
