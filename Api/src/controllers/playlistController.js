import prisma from '../lib/prisma.js';
import crypto from 'crypto';
import { emitToPlaylist } from '../lib/socket.js';

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
    const { visibility, q } = req.query;
    const currentUserId = req.user?.id || null;

    const where = {};

    if (q) {
      where.name = { contains: q, mode: 'insensitive' };
    }

    if (visibility === 'PUBLIC') {
      where.visibility = 'PUBLIC';
    } else if (visibility === 'PRIVATE') {
      // If user is not logged in, cannot see any private playlists
      if (!currentUserId) {
        return res.status(200).json({ playlists: [] });
      }
      where.visibility = 'PRIVATE';
      where.OR = [
        { ownerId: currentUserId },
        { invites: { some: { userId: currentUserId } } },
      ];
    } else {
      // Return public playlists + private playlists owned or invited
      if (currentUserId) {
        where.OR = [
          { visibility: 'PUBLIC' },
          { ownerId: currentUserId },
          { invites: { some: { userId: currentUserId } } },
        ];
      } else {
        where.visibility = 'PUBLIC';
      }
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
      playlists: playlists.map((p) => {
        const isOwner = currentUserId && p.ownerId === currentUserId;
        return {
          ...p,
          // CRITICAL SECURITY: hide inviteCode for non-owners in lists
          inviteCode: isOwner ? p.inviteCode : null,
          trackCount: p._count.tracks,
          previewCovers: p.tracks.map((t) => t.coverUrl).filter(Boolean),
        };
      }),
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
    const currentUserId = req.user?.id || null;

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

    const isOwner = Boolean(currentUserId && playlist.ownerId === currentUserId);
    const isInvited = Boolean(currentUserId && playlist.invites.some((inv) => inv.userId === currentUserId));

    // Visibility check: if PRIVATE, strictly require owner or invited user
    if (playlist.visibility === 'PRIVATE') {
      if (!currentUserId || (!isOwner && !isInvited)) {
        return res.status(403).json({ error: 'Accès interdit : cette playlist est privée' });
      }
    }

    // Check edit permission
    let canEdit = true;
    if (playlist.license === 'INVITED_ONLY') {
      const inviteWithEdit = currentUserId && playlist.invites.some((inv) => inv.userId === currentUserId && inv.canEdit);
      canEdit = isOwner || Boolean(inviteWithEdit);
    }

    // CRITICAL SECURITY: only the creator/owner of the playlist can see and share the inviteCode!
    const sanitizedPlaylist = {
      ...playlist,
      inviteCode: isOwner ? playlist.inviteCode : null,
    };

    return res.status(200).json({
      playlist: sanitizedPlaylist,
      canEdit,
      isOwner,
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
    const { name, description, visibility, license, coverUrl } = req.body;
    const ownerId = req.user?.id || 'anonymous';

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
        ownerId,
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
    const currentUserId = req.user?.id;

    const existing = await prisma.playlist.findUnique({
      where: { id },
      include: { invites: true },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Playlist introuvable' });
    }

    const isOwner = currentUserId && existing.ownerId === currentUserId;
    const isInvited = currentUserId && existing.invites.some((inv) => inv.userId === currentUserId && inv.canEdit);

    if (!isOwner && (existing.license === 'INVITED_ONLY' && !isInvited)) {
      return res.status(403).json({ error: 'Modification non autorisée' });
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

    emitToPlaylist(id, 'playlist:updated', {
      playlistId: id,
      playlist: updated,
      version: updated.version,
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
    const currentUserId = req.user?.id;

    const existing = await prisma.playlist.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Playlist introuvable' });
    }

    // Only owner can delete playlist
    if (!currentUserId || existing.ownerId !== currentUserId) {
      return res.status(403).json({ error: 'Seul le créateur peut supprimer cette playlist' });
    }

    await prisma.playlist.delete({ where: { id } });

    emitToPlaylist(id, 'playlist:deleted', {
      playlistId: id,
    });

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
    const { externalId, title, artist, album, coverUrl, preview, duration } = req.body;
    const currentUserId = req.user?.id || 'anonymous';

    if (!externalId || !title || !artist) {
      return res.status(400).json({ error: 'externalId, title et artist sont obligatoires' });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: { tracks: true, invites: true },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist introuvable' });
    }

    const isOwner = currentUserId && playlist.ownerId === currentUserId;
    const isInvited = currentUserId && playlist.invites.some((inv) => inv.userId === currentUserId && inv.canEdit);

    if (playlist.visibility === 'PRIVATE' && !isOwner && !isInvited) {
      return res.status(403).json({ error: 'Accès interdit à cette playlist privée' });
    }

    if (playlist.license === 'INVITED_ONLY' && !isOwner && !isInvited) {
      return res.status(403).json({ error: 'Seuls les membres invités peuvent modifier cette playlist' });
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
          addedBy: req.user?.name || req.user?.email || currentUserId,
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

    emitToPlaylist(id, 'track:added', {
      playlistId: id,
      track,
      playlistVersion: updatedPlaylist.version,
    });

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
    const currentUserId = req.user?.id;

    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: { invites: true },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist introuvable' });
    }

    const isOwner = currentUserId && playlist.ownerId === currentUserId;
    const isInvited = currentUserId && playlist.invites.some((inv) => inv.userId === currentUserId && inv.canEdit);

    if (playlist.license === 'INVITED_ONLY' && !isOwner && !isInvited) {
      return res.status(403).json({ error: 'Seuls les membres invités peuvent modifier cette playlist' });
    }

    const track = await prisma.playlistTrack.findUnique({
      where: { id: trackId },
    });

    if (!track || track.playlistId !== id) {
      return res.status(404).json({ error: 'Titre introuvable dans cette playlist' });
    }

    let newVersion = 1;

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
      const updatedPlaylist = await tx.playlist.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      newVersion = updatedPlaylist.version;
    });

    emitToPlaylist(id, 'track:removed', {
      playlistId: id,
      trackId,
      playlistVersion: newVersion,
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
    const currentUserId = req.user?.id;

    if (!Array.isArray(trackIds)) {
      return res.status(400).json({ error: 'trackIds doit être un tableau d\'identifiants' });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: { tracks: true, invites: true },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist introuvable' });
    }

    const isOwner = currentUserId && playlist.ownerId === currentUserId;
    const isInvited = currentUserId && playlist.invites.some((inv) => inv.userId === currentUserId && inv.canEdit);

    if (playlist.license === 'INVITED_ONLY' && !isOwner && !isInvited) {
      return res.status(403).json({ error: 'Seuls les membres invités peuvent modifier cette playlist' });
    }

    // Optimistic Concurrency Conflict Detection
    if (typeof expectedVersion === 'number' && playlist.version !== expectedVersion) {
      return res.status(409).json({
        error: 'Conflit de modification : un autre utilisateur a modifié la playlist en même temps',
        currentVersion: playlist.version,
        currentTracks: playlist.tracks.sort((a, b) => a.position - b.position),
      });
    }

    let nextVersion = playlist.version + 1;

    // Atomic update of positions
    await prisma.$transaction(async (tx) => {
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
      nextVersion = updated.version;
    });

    const updatedTracks = await prisma.playlistTrack.findMany({
      where: { playlistId: id },
      orderBy: { position: 'asc' },
    });

    emitToPlaylist(id, 'tracks:reordered', {
      playlistId: id,
      trackIds,
      tracks: updatedTracks,
      playlistVersion: nextVersion,
    });

    return res.status(200).json({
      success: true,
      tracks: updatedTracks,
      version: nextVersion,
    });
  } catch (error) {
    console.error('reorderTracks error:', error);
    return res.status(500).json({ error: error.message || 'Erreur lors de la réorganisation' });
  }
}

/**
 * POST /api/playlists/join
 * Join private playlist by invite code
 * Body: { inviteCode: string }
 */
export async function joinByCode(req, res) {
  try {
    const { inviteCode } = req.body;
    const userId = req.user?.id;

    if (!inviteCode || !inviteCode.trim()) {
      return res.status(400).json({ error: 'inviteCode est requis' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Vous devez être connecté pour rejoindre une playlist privée' });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { inviteCode: inviteCode.trim().toUpperCase() },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Code d\'invitation invalide' });
    }

    // Add invite for the authenticated user
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

    return res.status(200).json({
      playlist: {
        ...playlist,
        inviteCode: playlist.ownerId === userId ? playlist.inviteCode : null,
      },
    });
  } catch (error) {
    console.error('joinByCode error:', error);
    return res.status(500).json({ error: error.message || 'Erreur lors de la liaison' });
  }
}
