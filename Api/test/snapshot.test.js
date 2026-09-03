import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const state = {
  room: { id: 'room-1', ownerId: 'owner-1', isClosed: false, nowPlayingBy: null },
  tracks: [
    {
      id: 't1',
      roomId: 'room-1',
      externalId: 'e1',
      title: 'Low votes late',
      artist: 'A',
      album: null,
      preview: null,
      duration: 100,
      voteCount: 1,
      version: 1,
      position: 2,
      suggestedBy: 'u1',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      _count: { votes: 1 },
    },
    {
      id: 't2',
      roomId: 'room-1',
      externalId: 'e2',
      title: 'High votes early',
      artist: 'B',
      album: null,
      preview: null,
      duration: 120,
      voteCount: 5,
      version: 3,
      position: 1,
      suggestedBy: 'u2',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      _count: { votes: 5 },
    },
  ],
};

mock.module('../src/lib/prisma.js', {
  defaultExport: {
    room: {
      findUnique: async ({ where }) => (where.id === state.room.id ? state.room : null),
    },
    track: {
      findMany: async ({ where }) => {
        if (where.roomId !== state.room.id) return [];
        return [...state.tracks].sort(
          (a, b) =>
            b.voteCount - a.voteCount ||
            a.createdAt - b.createdAt ||
            (a.id < b.id ? -1 : 1)
        );
      },
    },
  },
});

const { getRoomSnapshot } = await import('../src/services/trackService.js');

test('getRoomSnapshot — salle introuvable → null', async () => {
  const snapshot = await getRoomSnapshot('missing');
  assert.equal(snapshot, null);
});

test('getRoomSnapshot — file ordonnée (voteCount desc, createdAt asc, id asc) + topTrack + nowPlayingBy + isClosed', async () => {
  const snapshot = await getRoomSnapshot('room-1');

  assert.equal(snapshot.topTrack.id, 't2');
  assert.equal(snapshot.queue[0].id, 't2');
  assert.equal(snapshot.queue[1].id, 't1');
  assert.equal(snapshot.queue[0]._count.votes, 5);
  assert.equal(snapshot.nowPlayingBy, 'owner-1');
  assert.equal(snapshot.isClosed, false);
});

test('getRoomSnapshot — nowPlayingBy et isClosed passés tels quels depuis la room', async () => {
  state.room = { id: 'room-2', ownerId: 'owner-2', isClosed: true, nowPlayingBy: 'player-9' };
  state.tracks = [];

  const snapshot = await getRoomSnapshot('room-2');

  assert.equal(snapshot.queue.length, 0);
  assert.equal(snapshot.topTrack, null);
  assert.equal(snapshot.nowPlayingBy, 'player-9');
  assert.equal(snapshot.isClosed, true);
});