let io = null;

export function setIo(instance) {
  io = instance;
}

export function roomChannel(roomId) {
  return `room:${roomId}`;
}

export function emitToRoom(roomId, event, payload) {
  if (!io) return;
  io.to(roomChannel(roomId)).emit(event, payload);
}
