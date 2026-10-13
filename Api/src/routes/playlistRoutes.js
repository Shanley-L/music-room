import express from 'express';
import {
  getPlaylists,
  getPlaylistById,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTrack,
  removeTrack,
  reorderTracks,
  joinByCode,
  inviteUser,
  removeInvite,
} from '../controllers/playlistController.js';

// Mounted behind authMiddleware in app.js: every route requires a JWT and the caller
// is always `req.user.id` (userId/ownerId sent in body or query are ignored).
const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Playlists
 *     description: >
 *       Music Playlist Editor. Authentification JWT obligatoire (401 sinon).
 *       Visibilité PUBLIC (tout utilisateur authentifié) ou PRIVATE (propriétaire et invités).
 *       Licence EVERYONE (toute personne ayant accès modifie les titres) ou INVITED_ONLY
 *       (propriétaire et invités avec canEdit). Seul le propriétaire modifie les réglages,
 *       supprime la playlist et gère les invitations.
 *
 * components:
 *   schemas:
 *     Playlist:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         description: { type: string, nullable: true }
 *         visibility: { type: string, enum: [PUBLIC, PRIVATE] }
 *         license: { type: string, enum: [EVERYONE, INVITED_ONLY] }
 *         inviteCode:
 *           type: string
 *           nullable: true
 *           description: Renseigné uniquement pour le propriétaire (null sinon)
 *         coverUrl: { type: string, nullable: true }
 *         version: { type: integer }
 *         ownerId: { type: string }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     PlaylistTrack:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         playlistId: { type: string }
 *         externalId: { type: string }
 *         title: { type: string }
 *         artist: { type: string }
 *         album: { type: string, nullable: true }
 *         coverUrl: { type: string, nullable: true }
 *         preview: { type: string, nullable: true }
 *         duration: { type: integer, nullable: true }
 *         position: { type: integer }
 *         addedBy: { type: string, description: 'Utilisateur authentifié ayant ajouté le titre' }
 *         createdAt: { type: string, format: date-time }
 *     PlaylistInvite:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         playlistId: { type: string }
 *         userId: { type: string }
 *         canEdit: { type: boolean }
 *         createdAt: { type: string, format: date-time }
 */

/**
 * @swagger
 * /api/playlists:
 *   get:
 *     summary: Lister les playlists visibles par l'utilisateur
 *     description: Playlists publiques, les miennes et celles où je suis invité ; jamais les playlists privées des autres.
 *     tags: [Playlists]
 *     parameters:
 *       - { in: query, name: visibility, schema: { type: string, enum: [PUBLIC, PRIVATE] }, description: 'PRIVATE = mes playlists privées et celles où je suis invité' }
 *       - { in: query, name: q, schema: { type: string }, description: 'Recherche par nom' }
 *     responses:
 *       200:
 *         description: Liste des playlists (avec trackCount et previewCovers)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 playlists:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Playlist'
 *                       - type: object
 *                         properties:
 *                           trackCount: { type: integer }
 *                           previewCovers: { type: array, items: { type: string } }
 *       401:
 *         description: Non authentifié
 *   post:
 *     summary: Créer une playlist
 *     description: Le propriétaire est l'utilisateur authentifié (un ownerId envoyé est ignoré).
 *     tags: [Playlists]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               visibility: { type: string, enum: [PUBLIC, PRIVATE], default: PUBLIC }
 *               license: { type: string, enum: [EVERYONE, INVITED_ONLY], default: EVERYONE }
 *               coverUrl: { type: string }
 *     responses:
 *       201:
 *         description: Playlist créée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 playlist: { $ref: '#/components/schemas/Playlist' }
 *       400:
 *         description: VALIDATION_ERROR
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: Non authentifié
 */
router.get('/', getPlaylists);
router.post('/', createPlaylist);

/**
 * @swagger
 * /api/playlists/join:
 *   post:
 *     summary: Rejoindre une playlist avec un code d'invitation
 *     description: Crée une invitation (canEdit = true) pour l'utilisateur authentifié.
 *     tags: [Playlists]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [inviteCode]
 *             properties:
 *               inviteCode: { type: string }
 *     responses:
 *       200:
 *         description: Playlist rejointe
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 playlist: { $ref: '#/components/schemas/Playlist' }
 *       400:
 *         description: VALIDATION_ERROR
 *       401:
 *         description: Non authentifié
 *       404:
 *         description: INVALID_INVITE_CODE
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/join', joinByCode);

/**
 * @swagger
 * /api/playlists/{id}:
 *   get:
 *     summary: Détail d'une playlist
 *     description: Une playlist privée n'est visible que du propriétaire et des invités. canEdit indique si l'utilisateur peut modifier les titres.
 *     tags: [Playlists]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Playlist avec ses titres et invitations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 playlist:
 *                   allOf:
 *                     - $ref: '#/components/schemas/Playlist'
 *                     - type: object
 *                       properties:
 *                         tracks: { type: array, items: { $ref: '#/components/schemas/PlaylistTrack' } }
 *                         invites: { type: array, items: { $ref: '#/components/schemas/PlaylistInvite' } }
 *                 canEdit: { type: boolean }
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: PLAYLIST_FORBIDDEN
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: PLAYLIST_NOT_FOUND
 *   put:
 *     summary: Modifier les réglages d'une playlist (propriétaire)
 *     description: >
 *       Passer la playlist en privé retire du canal temps réel les sockets des utilisateurs
 *       qui ne sont ni propriétaire ni invités.
 *     tags: [Playlists]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string, nullable: true }
 *               visibility: { type: string, enum: [PUBLIC, PRIVATE] }
 *               license: { type: string, enum: [EVERYONE, INVITED_ONLY] }
 *               coverUrl: { type: string, nullable: true }
 *               expectedVersion: { type: integer, description: 'Contrôle de concurrence optimiste' }
 *     responses:
 *       200:
 *         description: Playlist mise à jour
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 playlist: { $ref: '#/components/schemas/Playlist' }
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: NOT_PLAYLIST_OWNER
 *       404:
 *         description: PLAYLIST_NOT_FOUND
 *       409:
 *         description: VERSION_CONFLICT (avec currentVersion)
 *   delete:
 *     summary: Supprimer une playlist (propriétaire)
 *     tags: [Playlists]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Playlist supprimée
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: NOT_PLAYLIST_OWNER
 *       404:
 *         description: PLAYLIST_NOT_FOUND
 */
router.get('/:id', getPlaylistById);
router.put('/:id', updatePlaylist);
router.delete('/:id', deletePlaylist);

/**
 * @swagger
 * /api/playlists/{id}/invites:
 *   post:
 *     summary: Inviter un utilisateur (propriétaire)
 *     description: Idempotent ; un canEdit fourni met à jour une invitation existante.
 *     tags: [Playlists]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId: { type: string }
 *               canEdit: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Invitation créée ou mise à jour
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 invite: { $ref: '#/components/schemas/PlaylistInvite' }
 *       400:
 *         description: VALIDATION_ERROR
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: NOT_PLAYLIST_OWNER
 *       404:
 *         description: PLAYLIST_NOT_FOUND ou USER_NOT_FOUND
 */
router.post('/:id/invites', inviteUser);

/**
 * @swagger
 * /api/playlists/{id}/invites/{userId}:
 *   delete:
 *     summary: Révoquer l'invitation d'un utilisateur (propriétaire)
 *     description: Sur une playlist privée, les sockets de l'utilisateur révoqué quittent le canal temps réel.
 *     tags: [Playlists]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Invitation révoquée
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: NOT_PLAYLIST_OWNER
 *       404:
 *         description: PLAYLIST_NOT_FOUND ou INVITE_NOT_FOUND
 */
router.delete('/:id/invites/:userId', removeInvite);

/**
 * @swagger
 * /api/playlists/{id}/tracks:
 *   post:
 *     summary: Ajouter un titre
 *     description: Soumis à la licence (INVITED_ONLY = propriétaire et invités avec canEdit). addedBy est l'utilisateur authentifié.
 *     tags: [Playlists]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [externalId, title, artist]
 *             properties:
 *               externalId: { type: string }
 *               title: { type: string }
 *               artist: { type: string }
 *               album: { type: string }
 *               coverUrl: { type: string }
 *               preview: { type: string }
 *               duration: { type: integer }
 *     responses:
 *       201:
 *         description: Titre ajouté
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 track: { $ref: '#/components/schemas/PlaylistTrack' }
 *                 playlistVersion: { type: integer }
 *       400:
 *         description: VALIDATION_ERROR
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: PLAYLIST_FORBIDDEN ou PLAYLIST_EDIT_FORBIDDEN
 *       404:
 *         description: PLAYLIST_NOT_FOUND
 *       409:
 *         description: DUPLICATE_TRACK (isDuplicate = true)
 *       503:
 *         description: PLAYLIST_BUSY
 */
router.post('/:id/tracks', addTrack);

/**
 * @swagger
 * /api/playlists/{id}/tracks/{trackId}:
 *   delete:
 *     summary: Retirer un titre
 *     description: Soumis à la licence ; les positions restantes sont réindexées.
 *     tags: [Playlists]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: trackId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Titre supprimé
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: PLAYLIST_FORBIDDEN ou PLAYLIST_EDIT_FORBIDDEN
 *       404:
 *         description: PLAYLIST_NOT_FOUND ou TRACK_NOT_FOUND
 *       503:
 *         description: PLAYLIST_BUSY
 */
router.delete('/:id/tracks/:trackId', removeTrack);

/**
 * @swagger
 * /api/playlists/{id}/tracks/reorder:
 *   put:
 *     summary: Réordonner les titres
 *     description: Soumis à la licence ; sérialisé par playlist (verrou consultatif).
 *     tags: [Playlists]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [trackIds]
 *             properties:
 *               trackIds: { type: array, items: { type: string } }
 *               expectedVersion: { type: integer }
 *     responses:
 *       200:
 *         description: Nouvel ordre
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 tracks: { type: array, items: { $ref: '#/components/schemas/PlaylistTrack' } }
 *                 version: { type: integer }
 *       400:
 *         description: VALIDATION_ERROR
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: PLAYLIST_FORBIDDEN ou PLAYLIST_EDIT_FORBIDDEN
 *       404:
 *         description: PLAYLIST_NOT_FOUND
 *       409:
 *         description: VERSION_CONFLICT (avec currentVersion et currentTracks)
 *       503:
 *         description: PLAYLIST_BUSY
 */
router.put('/:id/tracks/reorder', reorderTracks);

export default router;
