import prisma from '../lib/prisma.js';

/**
 * Playlist visibility rule (same as `GET /api/playlists/:id`): public playlists are
 * open to everyone, private ones only to their owner and invited users.
 * `playlist.invites` is used when loaded, otherwise the invite is looked up.
 */
export async function isUserAllowedInPlaylist(playlist, userId) {
  if (playlist.visibility !== 'PRIVATE') return true;
  if (!userId) return false;
  if (playlist.ownerId === userId) return true;

  if (Array.isArray(playlist.invites)) {
    return playlist.invites.some((inv) => inv.userId === userId);
  }

  const invite = await prisma.playlistInvite.findUnique({
    where: { playlistId_userId: { playlistId: playlist.id, userId } },
  });
  return !!invite;
}

/** Full ordered track list of a playlist (server-authoritative order). */
export function getPlaylistTracks(playlistId) {
  return prisma.playlistTrack.findMany({
    where: { playlistId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
}
