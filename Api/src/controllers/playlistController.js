import prisma from '../lib/prisma.js';
import crypto from 'crypto';
import {
  isUserAllowedInPlaylist,
  canEditPlaylist,
  isPlaylistOwner,
  checkPlaylistAccess,
} from '../services/playlistService.js';
import {
  emitToPlaylist,
  emitPlaylistTracks,
  evictFromPlaylist,
  revokePlaylistAccess,
  revokePlaylistSubscribers,
} from '../lib/realtime.js';

// Locked transactions queue behind each other; leave room for bursts of edits.
const TX_OPTIONS = { maxWait: 15000, timeout: 20000 };

/** Public playlist fields broadcast in `playlist:updated` (no inviteCode, no invites). */
function publicPlaylist(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    visibility: p.visibility,
    license: p.license,
    coverUrl: p.coverUrl,
    version: p.version,
    ownerId: p.ownerId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function emitPlaylistUpdated(playlist) {
  emitToPlaylist(playlist.id, 'playlist:updated', {
    playlistId: playlist.id,
    playlist: publicPlaylist(playlist),
  });
}

/**
 * Playlist as returned to `userId`: the invite code is only revealed to the owner
 * (it grants an edit-capable invitation, so it must not leak through listings).
 */
function forViewer(playlist, userId) {
  return { ...playlist, inviteCode: isPlaylistOwner(playlist, userId) ? playlist.inviteCode : null };
}

function sendError(res, { status, error, code }) {
  return res.status(status).json({ error, code });
}

/** Prisma P2028: a locked transaction could not start or finish in time. */
function sendIfBusy(res, error) {
  if (error?.code !== 'P2028') return false;
  res.status(503).json({ error: 'Playlist occupée, réessayez', code: 'PLAYLIST_BUSY' });
  return true;
}

/** Serializes track writes on one playlist (positions stay consistent under concurrency). */
function lockPlaylist(tx, playlistId) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'playlist:' + playlistId}))`;
}

// Generate a random 6-character alphanumeric invite code
function generateInviteCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

/**
 * GET /api/playlists
 * Query params:
 * - visibility: 'PUBLIC' | 'PRIVATE' (optional)
 * - q: string (optional, search by name)
 * The caller comes from the JWT: public playlists + own + invited, never others' private ones.
 */
export async function getPlaylists(req, res) {
  try {
    const { visibility, q } = req.query;
    const userId = req.user.id;

    const where = {};

    if (q) {
      where.name = { contains: String(q), mode: 'insensitive' };
    }

    if (visibility === 'PUBLIC') {
      where.visibility = 'PUBLIC';
    } else if (visibility === 'PRIVATE') {
      where.visibility = 'PRIVATE';
      where.OR = [
        { ownerId: userId },
        { invites: { some: { userId: userId } } },
      ];
    } else {
      // Return public playlists + private playlists owned or invited
      where.OR = [
        { visibility: 'PUBLIC' },
        { ownerId: userId },
        { invites: { some: { userId: userId } } },
      ];
    }


    const playlists = await prisma.playlist.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { tracks: true },
        },
        tracks: {
          take: 4,
          orderBy: { position: 'asc' },
          select: { coverUrl: true },
        },
      },
    });

    return res.status(200).json({
      playlists: playlists.map((p) => ({
        ...forViewer(p, userId),
        trackCount: p._count.tracks,
        previewCovers: p.tracks.map((t) => t.coverUrl).filter(Boolean),
      })),
    });
  } catch (error) {
    console.error('getPlaylists error:', error);
    return res.status(500).json({ error: 'Erreur interne', code: 'INTERNAL_ERROR' });
  }
}

/**
 * GET /api/playlists/:id
 */
export async function getPlaylistById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        tracks: {
          orderBy: { position: 'asc' },
        },
        invites: true,
      },
    });

    // Visibility: a private playlist is only readable by its owner and invitees.
    const denied = await checkPlaylistAccess(playlist, userId, 'read');
    if (denied) return sendError(res, denied);

    const canEdit = await canEditPlaylist(playlist, userId);

    return res.status(200).json({
      playlist: forViewer(playlist, userId),
      canEdit,
    });
  } catch (error) {
    console.error('getPlaylistById error:', error);
    return res.status(500).json({ error: 'Erreur interne', code: 'INTERNAL_ERROR' });
  }
}

/**
 * POST /api/playlists
 */
export async function createPlaylist(req, res) {
  try {
    // Any ownerId sent by the client is ignored: the owner is the authenticated caller.
    const { name, description, visibility, license, coverUrl } = req.body ?? {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Le nom de la playlist est obligatoire', code: 'VALIDATION_ERROR' });
    }

    const inviteCode = generateInviteCode();

    const playlist = await prisma.playlist.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        visibility: visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        license: license === 'INVITED_ONLY' ? 'INVITED_ONLY' : 'EVERYONE',
        coverUrl: coverUrl || null,
        ownerId: req.user.id,
        inviteCode,
      },
    });

    return res.status(201).json({ playlist });
  } catch (error) {
    console.error('createPlaylist error:', error);
    return res.status(500).json({ error: 'Erreur lors de la création', code: 'INTERNAL_ERROR' });
  }
}

/**
 * PUT /api/playlists/:id
 */
export async function updatePlaylist(req, res) {
  try {
    const { id } = req.params;
    const { name, description, visibility, license, coverUrl, expectedVersion } = req.body ?? {};

    const existing = await prisma.playlist.findUnique({ where: { id } });
    const denied = await checkPlaylistAccess(existing, req.user.id, 'owner');
    if (denied) return sendError(res, denied);

    // Optimistic concurrency check if expectedVersion is provided
    if (typeof expectedVersion === 'number' && existing.version !== expectedVersion) {
      return res.status(409).json({
        error: 'Conflit de version : la playlist a été modifiée par un autre utilisateur',
        code: 'VERSION_CONFLICT',
        currentVersion: existing.version,
      });
    }

    const updated = await prisma.playlist.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(visibility && { visibility }),
        ...(license && { license }),
        ...(coverUrl !== undefined && { coverUrl }),
        version: { increment: 1 },
      },
    });

    // Realtime: when the playlist is private, sockets of users without access leave it
    // before the update is broadcast.
    if (updated.visibility === 'PRIVATE') {
      const invites = await prisma.playlistInvite.findMany({
        where: { playlistId: id },
        select: { userId: true },
      });
      const allowed = new Set([updated.ownerId, ...invites.map((inv) => inv.userId)]);
      await revokePlaylistSubscribers(id, (userId) => allowed.has(userId));
    }

    emitPlaylistUpdated(updated);

    return res.status(200).json({ playlist: updated });
  } catch (error) {
    console.error('updatePlaylist error:', error);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour', code: 'INTERNAL_ERROR' });
  }
}

/**
 * DELETE /api/playlists/:id
 */
export async function deletePlaylist(req, res) {
  try {
    const { id } = req.params;

    const existing = await prisma.playlist.findUnique({ where: { id } });
    const denied = await checkPlaylistAccess(existing, req.user.id, 'owner');
    if (denied) return sendError(res, denied);

    await prisma.playlist.delete({ where: { id } });

    emitToPlaylist(id, 'playlist:deleted', { playlistId: id });
    await evictFromPlaylist(id);

    return res.status(200).json({ success: true, message: 'Playlist supprimée' });
  } catch (error) {
    console.error('deletePlaylist error:', error);
    return res.status(500).json({ error: 'Erreur lors de la suppression', code: 'INTERNAL_ERROR' });
  }
}

/**
 * POST /api/playlists/:id/tracks
 * Add a track to playlist
 */
export async function addTrack(req, res) {
  try {
    const { id } = req.params;
    const { externalId, title, artist, album, coverUrl, preview, duration } = req.body ?? {};

    if (!externalId || typeof title !== 'string' || !title || typeof artist !== 'string' || !artist) {
      return res.status(400).json({
        error: 'externalId, title et artist sont obligatoires',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockPlaylist(tx, id);

      const playlist = await tx.playlist.findUnique({
        where: { id },
        include: { tracks: true, invites: true },
      });

      const denied = await checkPlaylistAccess(playlist, req.user.id, 'edit');
      if (denied) return { status: denied.status, body: { error: denied.error, code: denied.code } };

      // Check for duplicates in playlist
      const isDuplicate = playlist.tracks.some(
        (t) => String(t.externalId) === String(externalId)
      );

      if (isDuplicate) {
        return {
          status: 409,
          body: {
            error: 'Cette musique est déjà dans la playlist',
            code: 'DUPLICATE_TRACK',
            isDuplicate: true,
          },
        };
      }

      // Determine position: next after max position
      const maxPosition = playlist.tracks.reduce((max, t) => Math.max(max, t.position), -1);
      const newPosition = maxPosition + 1;

      // Use coverUrl if playlist doesn't have one yet
      const updateCover = !playlist.coverUrl && coverUrl;

      const track = await tx.playlistTrack.create({
        data: {
          playlistId: id,
          externalId: String(externalId),
          title: title.trim(),
          artist: artist.trim(),
          album: album?.trim() || null,
          coverUrl: coverUrl || null,
          preview: preview || null,
          duration: duration ? Number(duration) : null,
          position: newPosition,
          addedBy: req.user.id,
        },
      });
      const updatedPlaylist = await tx.playlist.update({
        where: { id },
        data: {
          version: { increment: 1 },
          ...(updateCover ? { coverUrl } : {}),
        },
      });

      return { status: 201, track, updatedPlaylist, updateCover };
    }, TX_OPTIONS);

    if (result.status !== 201) return res.status(result.status).json(result.body);

    const { track, updatedPlaylist, updateCover } = result;
    emitPlaylistTracks(id);
    if (updateCover) {
      emitPlaylistUpdated(updatedPlaylist);
    }

    return res.status(201).json({
      track,
      playlistVersion: updatedPlaylist.version,
    });
  } catch (error) {
    if (sendIfBusy(res, error)) return;
    console.error('addTrack error:', error);
    return res.status(500).json({ error: "Erreur lors de l'ajout du titre", code: 'INTERNAL_ERROR' });
  }
}

/**
 * DELETE /api/playlists/:id/tracks/:trackId
 * Remove a track and reorder remaining tracks
 */
export async function removeTrack(req, res) {
  try {
    const { id, trackId } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      await lockPlaylist(tx, id);

      const playlist = await tx.playlist.findUnique({ where: { id }, include: { invites: true } });
      const denied = await checkPlaylistAccess(playlist, req.user.id, 'edit');
      if (denied) return denied;

      const track = await tx.playlistTrack.findUnique({
        where: { id: trackId },
      });

      if (!track || track.playlistId !== id) {
        return { status: 404, error: 'Titre introuvable dans cette playlist', code: 'TRACK_NOT_FOUND' };
      }

      // Delete the track
      await tx.playlistTrack.delete({ where: { id: trackId } });

      // Fetch remaining tracks and reindex positions
      const remainingTracks = await tx.playlistTrack.findMany({
        where: { playlistId: id },
        orderBy: { position: 'asc' },
      });

      for (let i = 0; i < remainingTracks.length; i++) {
        if (remainingTracks[i].position !== i) {
          await tx.playlistTrack.update({
            where: { id: remainingTracks[i].id },
            data: { position: i },
          });
        }
      }

      // Increment version
      await tx.playlist.update({
        where: { id },
        data: { version: { increment: 1 } },
      });

      return null;
    }, TX_OPTIONS);

    if (result) return sendError(res, result);

    emitPlaylistTracks(id);

    return res.status(200).json({ success: true, message: 'Titre supprimé avec succès' });
  } catch (error) {
    if (sendIfBusy(res, error)) return;
    console.error('removeTrack error:', error);
    return res.status(500).json({ error: 'Erreur lors de la suppression', code: 'INTERNAL_ERROR' });
  }
}

/**
 * PUT /api/playlists/:id/tracks/reorder
 * Reorder tracks in a playlist with conflict handling
 * Body: { trackIds: string[], expectedVersion?: number }
 */
export async function reorderTracks(req, res) {
  try {
    const { id } = req.params;
    const { trackIds, expectedVersion } = req.body ?? {};

    if (!Array.isArray(trackIds) || !trackIds.every((t) => typeof t === 'string')) {
      return res.status(400).json({
        error: 'trackIds doit être un tableau d\'identifiants',
        code: 'VALIDATION_ERROR',
      });
    }

    // Atomic update of positions, serialized per playlist so concurrent reorders
    // apply one after the other (the last committed order wins).
    const result = await prisma.$transaction(async (tx) => {
      await lockPlaylist(tx, id);

      const playlist = await tx.playlist.findUnique({
        where: { id },
        include: { tracks: true, invites: true },
      });

      const denied = await checkPlaylistAccess(playlist, req.user.id, 'edit');
      if (denied) return { status: denied.status, body: { error: denied.error, code: denied.code } };

      // Optimistic Concurrency Conflict Detection
      if (typeof expectedVersion === 'number' && playlist.version !== expectedVersion) {
        return {
          status: 409,
          body: {
            error: 'Conflit de modification : un autre utilisateur a modifié la playlist en même temps',
            code: 'VERSION_CONFLICT',
            currentVersion: playlist.version,
            currentTracks: playlist.tracks.sort((a, b) => a.position - b.position),
          },
        };
      }

      for (let i = 0; i < trackIds.length; i++) {
        await tx.playlistTrack.updateMany({
          where: { id: trackIds[i], playlistId: id },
          data: { position: i },
        });
      }

      const updated = await tx.playlist.update({
        where: { id },
        data: { version: { increment: 1 } },
      });

      return { status: 200, version: updated.version };
    }, TX_OPTIONS);

    if (result.status !== 200) return res.status(result.status).json(result.body);

    emitPlaylistTracks(id);

    const updatedTracks = await prisma.playlistTrack.findMany({
      where: { playlistId: id },
      orderBy: { position: 'asc' },
    });

    return res.status(200).json({
      success: true,
      tracks: updatedTracks,
      version: result.version,
    });
  } catch (error) {
    if (sendIfBusy(res, error)) return;
    console.error('reorderTracks error:', error);
    return res.status(500).json({ error: 'Erreur lors de la réorganisation', code: 'INTERNAL_ERROR' });
  }
}

/**
 * POST /api/playlists/join
 * Join a playlist by invite code; the invite is created for the authenticated caller.
 * Body: { inviteCode: string }
 */
export async function joinByCode(req, res) {
  try {
    const { inviteCode } = req.body ?? {};
    const userId = req.user.id;

    if (typeof inviteCode !== 'string' || !inviteCode.trim()) {
      return res.status(400).json({ error: 'inviteCode est requis', code: 'VALIDATION_ERROR' });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { inviteCode: inviteCode.trim().toUpperCase() },
    });

    if (!playlist) {
      return res.status(404).json({ error: "Code d'invitation invalide", code: 'INVALID_INVITE_CODE' });
    }

    // The owner already has every right: no invite row for them.
    if (!isPlaylistOwner(playlist, userId)) {
      await prisma.playlistInvite.upsert({
        where: { playlistId_userId: { playlistId: playlist.id, userId } },
        create: { playlistId: playlist.id, userId, canEdit: true },
        update: {},
      });
    }

    return res.status(200).json({ playlist: forViewer(playlist, userId) });
  } catch (error) {
    console.error('joinByCode error:', error);
    return res.status(500).json({ error: 'Erreur lors de la liaison', code: 'INTERNAL_ERROR' });
  }
}

/**
 * POST /api/playlists/:id/invites (owner only)
 * Body: { userId: string, canEdit?: boolean (default true) }
 */
export async function inviteUser(req, res) {
  try {
    const { id } = req.params;
    const { userId, canEdit } = req.body ?? {};

    if (typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'userId est requis', code: 'VALIDATION_ERROR' });
    }
    if (canEdit !== undefined && typeof canEdit !== 'boolean') {
      return res.status(400).json({ error: 'canEdit doit être un booléen', code: 'VALIDATION_ERROR' });
    }

    const playlist = await prisma.playlist.findUnique({ where: { id } });
    const denied = await checkPlaylistAccess(playlist, req.user.id, 'owner');
    if (denied) return sendError(res, denied);

    if (userId === playlist.ownerId) {
      return res.status(400).json({
        error: 'Le propriétaire ne peut pas être invité à sa propre playlist',
        code: 'VALIDATION_ERROR',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable', code: 'USER_NOT_FOUND' });
    }

    const invite = await prisma.playlistInvite.upsert({
      where: { playlistId_userId: { playlistId: id, userId } },
      create: { playlistId: id, userId, canEdit: canEdit ?? true },
      update: canEdit === undefined ? {} : { canEdit },
    });

    return res.status(201).json({ invite });
  } catch (error) {
    console.error('inviteUser error:', error);
    return res.status(500).json({ error: "Erreur lors de l'invitation", code: 'INTERNAL_ERROR' });
  }
}

/**
 * DELETE /api/playlists/:id/invites/:userId (owner only)
 * A revoked user who loses access (private playlist) stops receiving playlist events.
 */
export async function removeInvite(req, res) {
  try {
    const { id, userId } = req.params;

    const playlist = await prisma.playlist.findUnique({ where: { id } });
    const denied = await checkPlaylistAccess(playlist, req.user.id, 'owner');
    if (denied) return sendError(res, denied);

    const { count } = await prisma.playlistInvite.deleteMany({ where: { playlistId: id, userId } });
    if (count === 0) {
      return res.status(404).json({ error: 'Invitation introuvable', code: 'INVITE_NOT_FOUND' });
    }

    if (!(await isUserAllowedInPlaylist(playlist, userId))) {
      await revokePlaylistAccess(id, [userId]);
    }

    return res.status(204).end();
  } catch (error) {
    console.error('removeInvite error:', error);
    return res.status(500).json({ error: "Erreur lors de la révocation", code: 'INTERNAL_ERROR' });
  }
}
