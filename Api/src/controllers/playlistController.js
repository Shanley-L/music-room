import prisma from '../lib/prisma.js';
import crypto from 'crypto';
import { isUserAllowedInPlaylist } from '../services/playlistService.js';
import {
  emitToPlaylist,
  emitPlaylistTracks,
  evictFromPlaylist,
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
 * - userId: string (optional, to filter user's playlists/invites)
 * - q: string (optional, search by name)
 */
export async function getPlaylists(req, res) {
  try {
    const { visibility, userId, q } = req.query;

    const where = {};

    if (q) {
      where.name = { contains: q, mode: 'insensitive' };
    }

    const effectiveUserId = userId || 'anonymous';

    if (visibility === 'PUBLIC') {
      where.visibility = 'PUBLIC';
    } else if (visibility === 'PRIVATE') {
      where.visibility = 'PRIVATE';
      where.OR = [
        { ownerId: effectiveUserId },
        { invites: { some: { userId: effectiveUserId } } },
      ];
    } else {
      // Return public playlists + private playlists owned or invited
      where.OR = [
        { visibility: 'PUBLIC' },
        { ownerId: effectiveUserId },
        { invites: { some: { userId: effectiveUserId } } },
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
        ...p,
        trackCount: p._count.tracks,
        previewCovers: p.tracks.map((t) => t.coverUrl).filter(Boolean),
      })),
    });
  } catch (error) {
    console.error('getPlaylists error:', error);
    return res.status(500).json({ error: error.message || 'Erreur interne' });
  }
}

/**
 * GET /api/playlists/:id
 */
export async function getPlaylistById(req, res) {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        tracks: {
          orderBy: { position: 'asc' },
        },
        invites: true,
      },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist introuvable' });
    }

    // Visibility check: if PRIVATE, check if user is owner or invited
    if (userId && !(await isUserAllowedInPlaylist(playlist, userId))) {
      return res.status(403).json({ error: 'Accès non autorisé à cette playlist privée' });
    }

    // Check edit permission
    let canEdit = true;
    if (playlist.license === 'INVITED_ONLY' && userId) {
      const isOwner = playlist.ownerId === userId;
      const isInvited = playlist.invites.some((inv) => inv.userId === userId && inv.canEdit);
      canEdit = isOwner || isInvited;
    }

    return res.status(200).json({
      playlist,
      canEdit,
    });
  } catch (error) {
    console.error('getPlaylistById error:', error);
    return res.status(500).json({ error: error.message || 'Erreur interne' });
  }
}

/**
 * POST /api/playlists
 */
export async function createPlaylist(req, res) {
  try {
    const { name, description, visibility, license, coverUrl, ownerId } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Le nom de la playlist est obligatoire' });
    }

    const inviteCode = generateInviteCode();

    const playlist = await prisma.playlist.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        visibility: visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        license: license === 'INVITED_ONLY' ? 'INVITED_ONLY' : 'EVERYONE',
        coverUrl: coverUrl || null,
        ownerId: ownerId || 'anonymous',
        inviteCode,
      },
    });

    return res.status(201).json({ playlist });
  } catch (error) {
    console.error('createPlaylist error:', error);
    return res.status(500).json({ error: error.message || 'Erreur lors de la création' });
  }
}

/**
 * PUT /api/playlists/:id
 */
export async function updatePlaylist(req, res) {
  try {
    const { id } = req.params;
    const { name, description, visibility, license, coverUrl, expectedVersion } = req.body;

    const existing = await prisma.playlist.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Playlist introuvable' });
    }

    // Optimistic concurrency check if expectedVersion is provided
    if (typeof expectedVersion === 'number' && existing.version !== expectedVersion) {
      return res.status(409).json({
        error: 'Conflit de version : la playlist a été modifiée par un autre utilisateur',
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
      await evictFromPlaylist(id, (socket) => !allowed.has(socket.data?.userId));
    }

    emitPlaylistUpdated(updated);

    return res.status(200).json({ playlist: updated });
  } catch (error) {
    console.error('updatePlaylist error:', error);
    return res.status(500).json({ error: error.message || 'Erreur lors de la mise à jour' });
  }
}

/**
 * DELETE /api/playlists/:id
 */
export async function deletePlaylist(req, res) {
  try {
    const { id } = req.params;

    await prisma.playlist.delete({ where: { id } });

    emitToPlaylist(id, 'playlist:deleted', { playlistId: id });
    await evictFromPlaylist(id);

    return res.status(200).json({ success: true, message: 'Playlist supprimée' });
  } catch (error) {
    console.error('deletePlaylist error:', error);
    return res.status(500).json({ error: error.message || 'Erreur lors de la suppression' });
  }
}

/**
 * POST /api/playlists/:id/tracks
 * Add a track to playlist
 */
export async function addTrack(req, res) {
  try {
    const { id } = req.params;
    const { externalId, title, artist, album, coverUrl, preview, duration, addedBy } = req.body;

    if (!externalId || !title || !artist) {
      return res.status(400).json({ error: 'externalId, title et artist sont obligatoires' });
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockPlaylist(tx, id);

      const playlist = await tx.playlist.findUnique({
        where: { id },
        include: { tracks: true },
      });

      if (!playlist) return { status: 404, body: { error: 'Playlist introuvable' } };

      // Check for duplicates in playlist
      const isDuplicate = playlist.tracks.some(
        (t) => String(t.externalId) === String(externalId)
      );

      if (isDuplicate) {
        return {
          status: 409,
          body: { error: 'Cette musique est déjà dans la playlist', isDuplicate: true },
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
          addedBy: addedBy || 'anonymous',
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
    return res.status(500).json({ error: error.message || "Erreur lors de l'ajout du titre" });
  }
}

/**
 * DELETE /api/playlists/:id/tracks/:trackId
 * Remove a track and reorder remaining tracks
 */
export async function removeTrack(req, res) {
  try {
    const { id, trackId } = req.params;

    const found = await prisma.$transaction(async (tx) => {
      await lockPlaylist(tx, id);

      const track = await tx.playlistTrack.findUnique({
        where: { id: trackId },
      });

      if (!track || track.playlistId !== id) return false;

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

      return true;
    }, TX_OPTIONS);

    if (!found) {
      return res.status(404).json({ error: 'Titre introuvable dans cette playlist' });
    }

    emitPlaylistTracks(id);

    return res.status(200).json({ success: true, message: 'Titre supprimé avec succès' });
  } catch (error) {
    if (sendIfBusy(res, error)) return;
    console.error('removeTrack error:', error);
    return res.status(500).json({ error: error.message || 'Erreur lors de la suppression' });
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
    const { trackIds, expectedVersion } = req.body;

    if (!Array.isArray(trackIds)) {
      return res.status(400).json({ error: 'trackIds doit être un tableau d\'identifiants' });
    }

    // Atomic update of positions, serialized per playlist so concurrent reorders
    // apply one after the other (the last committed order wins).
    const result = await prisma.$transaction(async (tx) => {
      await lockPlaylist(tx, id);

      const playlist = await tx.playlist.findUnique({
        where: { id },
        include: { tracks: true },
      });

      if (!playlist) return { status: 404, body: { error: 'Playlist introuvable' } };

      // Optimistic Concurrency Conflict Detection
      if (typeof expectedVersion === 'number' && playlist.version !== expectedVersion) {
        return {
          status: 409,
          body: {
            error: 'Conflit de modification : un autre utilisateur a modifié la playlist en même temps',
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
    return res.status(500).json({ error: error.message || 'Erreur lors de la réorganisation' });
  }
}

/**
 * POST /api/playlists/join
 * Join private playlist by invite code
 * Body: { inviteCode: string, userId: string }
 */
export async function joinByCode(req, res) {
  try {
    const { inviteCode, userId } = req.body;

    if (!inviteCode || !userId) {
      return res.status(400).json({ error: 'inviteCode et userId sont requis' });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { inviteCode: inviteCode.trim().toUpperCase() },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Code d\'invitation invalide' });
    }

    // Add invite
    await prisma.playlistInvite.upsert({
      where: {
        playlistId_userId: {
          playlistId: playlist.id,
          userId,
        },
      },
      create: {
        playlistId: playlist.id,
        userId,
        canEdit: true,
      },
      update: {},
    });

    return res.status(200).json({ playlist });
  } catch (error) {
    console.error('joinByCode error:', error);
    return res.status(500).json({ error: error.message || 'Erreur lors de la liaison' });
  }
}
