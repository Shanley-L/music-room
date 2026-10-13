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

/** True when `userId` owns the playlist (settings, deletion, invitations). */
export function isPlaylistOwner(playlist, userId) {
  return !!userId && playlist.ownerId === userId;
}

/**
 * Track edit rule (add, remove, reorder): the user must have access to the playlist;
 * license EVERYONE then lets them edit, INVITED_ONLY limits edits to the owner and
 * invitees with `canEdit`. `playlist.invites` is used when loaded.
 */
export async function canEditPlaylist(playlist, userId) {
  if (!userId) return false;
  if (!(await isUserAllowedInPlaylist(playlist, userId))) return false;
  if (playlist.license !== 'INVITED_ONLY') return true;
  if (isPlaylistOwner(playlist, userId)) return true;

  if (Array.isArray(playlist.invites)) {
    return playlist.invites.some((inv) => inv.userId === userId && inv.canEdit);
  }

  const invite = await prisma.playlistInvite.findUnique({
    where: { playlistId_userId: { playlistId: playlist.id, userId } },
  });
  return !!invite?.canEdit;
}

/**
 * Access check shared by the REST handlers. Returns null when allowed, otherwise
 * `{ status, error, code }`. `mode`: 'read' (visibility), 'edit' (tracks), 'owner'.
 */
export async function checkPlaylistAccess(playlist, userId, mode = 'read') {
  if (!playlist) return { status: 404, error: 'Playlist introuvable', code: 'PLAYLIST_NOT_FOUND' };

  if (mode === 'owner') {
    if (isPlaylistOwner(playlist, userId)) return null;
    return { status: 403, error: 'Action réservée au propriétaire de la playlist', code: 'NOT_PLAYLIST_OWNER' };
  }

  if (!(await isUserAllowedInPlaylist(playlist, userId))) {
    return { status: 403, error: 'Accès non autorisé à cette playlist privée', code: 'PLAYLIST_FORBIDDEN' };
  }

  if (mode === 'edit' && !(await canEditPlaylist(playlist, userId))) {
    return {
      status: 403,
      error: 'Seuls le propriétaire et les invités autorisés peuvent modifier cette playlist',
      code: 'PLAYLIST_EDIT_FORBIDDEN',
    };
  }

  return null;
}
