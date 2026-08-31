import prisma from '../lib/prisma.js';
import crypto from 'crypto';

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
    if (playlist.visibility === 'PRIVATE' && userId) {
      const isOwner = playlist.ownerId === userId;
      const isInvited = playlist.invites.some((inv) => inv.userId === userId);
      if (!isOwner && !isInvited) {
        return res.status(403).json({ error: 'Accès non autorisé à cette playlist privée' });
      }
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

    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: { tracks: true },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist introuvable' });
    }

    // Check for duplicates in playlist
    const isDuplicate = playlist.tracks.some(
      (t) => String(t.externalId) === String(externalId)
    );

    if (isDuplicate) {
      return res.status(409).json({
        error: 'Cette musique est déjà dans la playlist',
        isDuplicate: true,
      });
    }

    // Determine position: next after max position
    const maxPosition = playlist.tracks.reduce((max, t) => Math.max(max, t.position), -1);
    const newPosition = maxPosition + 1;

    // Use coverUrl if playlist doesn't have one yet
    const updateCover = !playlist.coverUrl && coverUrl;


    const [track, updatedPlaylist] = await prisma.$transaction([
      prisma.playlistTrack.create({
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
      }),
      prisma.playlist.update({
        where: { id },
        data: {
          version: { increment: 1 },
          ...(updateCover ? { coverUrl } : {}),
        },
      }),
    ]);

    return res.status(201).json({
      track,
      playlistVersion: updatedPlaylist.version,
    });
  } catch (error) {
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

    const track = await prisma.playlistTrack.findUnique({
      where: { id: trackId },
    });

    if (!track || track.playlistId !== id) {
      return res.status(404).json({ error: 'Titre introuvable dans cette playlist' });
    }

    await prisma.$transaction(async (tx) => {
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
    });

    return res.status(200).json({ success: true, message: 'Titre supprimé avec succès' });
  } catch (error) {
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

    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: { tracks: true },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist introuvable' });
    }

    // Optimistic Concurrency Conflict Detection
    if (typeof expectedVersion === 'number' && playlist.version !== expectedVersion) {
      return res.status(409).json({
        error: 'Conflit de modification : un autre utilisateur a modifié la playlist en même temps',
        currentVersion: playlist.version,
        currentTracks: playlist.tracks.sort((a, b) => a.position - b.position),
      });
    }

    // Atomic update of positions
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < trackIds.length; i++) {
        await tx.playlistTrack.updateMany({
          where: { id: trackIds[i], playlistId: id },
          data: { position: i },
        });
      }

      await tx.playlist.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
    });

    const updatedTracks = await prisma.playlistTrack.findMany({
      where: { playlistId: id },
      orderBy: { position: 'asc' },
    });

    return res.status(200).json({
      success: true,
      tracks: updatedTracks,
      version: playlist.version + 1,
    });
  } catch (error) {
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
