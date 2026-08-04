import assert from 'assert';
import { roomChannel, emitToRoom, setIo } from '../src/socket/emit.js';

assert.equal(roomChannel('abc'), 'room:abc');

let called = null;
setIo({
  to(channel) {
    return {
      emit(event, payload) {
        called = { channel, event, payload };
      },
    };
  },
});

emitToRoom('rid', 'queue:updated', { roomId: 'rid', tracks: [] });
assert.deepEqual(called, {
  channel: 'room:rid',
  event: 'queue:updated',
  payload: { roomId: 'rid', tracks: [] },
});

setIo(null);
called = null;
emitToRoom('rid', 'queue:updated', { roomId: 'rid' });
assert.equal(called, null);

console.log('emit unit OK');
