import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  create,
  listPublic,
  mine,
  getOne,
  join,
  invite,
  removeInvite,
  remove,
  regenerateCode,
  update,
} from '../controllers/roomController.js';
import { joinCodeLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   - name: Rooms
 *     description: Music Track Vote, salles d'événement (visibilité, licences de vote)
 *
 * components:
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         error: { type: string, example: 'Salle introuvable' }
 *         code: { type: string, example: 'ROOM_NOT_FOUND' }
 *     Room:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         visibility: { type: string, enum: [PUBLIC, PRIVATE] }
 *         license: { type: string, enum: [EVERYONE, INVITED_ONLY, GEO_TIME_RESTRICTED] }
 *         inviteCode:
 *           type: string
 *           nullable: true
 *           description: Visible uniquement par le propriétaire
 *         latitude: { type: number, nullable: true }
 *         longitude: { type: number, nullable: true }
 *         radiusM: { type: integer, nullable: true }
 *         voteStartAt: { type: string, format: date-time, nullable: true }
 *         voteEndAt: { type: string, format: date-time, nullable: true }
 *         ownerId: { type: string }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *         invites:
 *           type: array
 *           description: Visible uniquement par le propriétaire
 *           items: { $ref: '#/components/schemas/RoomInvite' }
 *         playbackStatus: { type: string, enum: [IDLE, PLAYING, PAUSED] }
 *         currentTrackId: { type: string, nullable: true }
 *         myRole:
 *           type: string
 *           enum: [OWNER, INVITED, MEMBER]
 *           description: Uniquement sur GET/PATCH /api/rooms/{id}
 *         permissions:
 *           type: object
 *           description: Calculées côté serveur (GET/PATCH /api/rooms/{id})
 *           properties:
 *             canVote: { type: boolean, description: 'true aussi quand la position est requise (voteRequiresLocation)' }
 *             voteRequiresLocation: { type: boolean }
 *             voteBlockedReason: { type: string, nullable: true }
 *             voteBlockedCode: { type: string, nullable: true }
 *             canSuggest: { type: boolean }
 *             canControlPlayback: { type: boolean }
 *             canManageRoom: { type: boolean }
 *             canInvite: { type: boolean }
 *             canRemoveTrack: { type: boolean }
 *     RoomInvite:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         roomId: { type: string }
 *         userId: { type: string }
 *         createdAt: { type: string, format: date-time }
 *     CreateRoomInput:
 *       type: object
 *       required: [name]
 *       properties:
 *         name: { type: string, maxLength: 100 }
 *         visibility: { type: string, enum: [PUBLIC, PRIVATE], default: PUBLIC }
 *         license: { type: string, enum: [EVERYONE, INVITED_ONLY, GEO_TIME_RESTRICTED], default: EVERYONE }
 *         latitude: { type: number, description: 'Centre de la zone de vote (avec longitude et radiusM)' }
 *         longitude: { type: number }
 *         radiusM: { type: integer, description: 'Rayon de la zone en mètres' }
 *         voteStartAt: { type: string, format: date-time }
 *         voteEndAt: { type: string, format: date-time }
 */

/**
 * @swagger
 * /api/rooms:
 *   post:
 *     summary: Créer une salle
 *     description: >
 *       Salle publique et licence EVERYONE par défaut. Une salle privée reçoit un code d'invitation.
 *       La licence GEO_TIME_RESTRICTED exige une zone (latitude, longitude, radiusM) et/ou une plage horaire.
 *     tags: [Rooms]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateRoomInput' }
 *     responses:
 *       201:
 *         description: Salle créée
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Room' }
 *       400:
 *         description: Entrée invalide (VALIDATION_ERROR) ou configuration géo manquante (GEO_CONFIG_REQUIRED)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: Non authentifié
 */
router.post('/', create);

/**
 * @swagger
 * /api/rooms/public:
 *   get:
 *     summary: Lister les salles publiques
 *     description: Ne renvoie jamais de salle privée ni de code d'invitation.
 *     tags: [Rooms]
 *     responses:
 *       200:
 *         description: Liste des salles publiques
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Room' }
 */
router.get('/public', listPublic);

/**
 * @swagger
 * /api/rooms/mine:
 *   get:
 *     summary: Lister mes salles
 *     description: Salles dont je suis propriétaire ou auxquelles je suis invité. Le code d'invitation n'apparaît que pour mes propres salles.
 *     tags: [Rooms]
 *     responses:
 *       200:
 *         description: Liste de mes salles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Room' }
 */
router.get('/mine', mine);

/**
 * @swagger
 * /api/rooms/join:
 *   post:
 *     summary: Rejoindre une salle avec un code d'invitation
 *     tags: [Rooms]
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
 *         description: Salle rejointe
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Room' }
 *       400:
 *         description: VALIDATION_ERROR
 *       404:
 *         description: INVALID_INVITE_CODE
 *       429:
 *         description: RATE_LIMITED (tentatives de code limitées par utilisateur, budget partagé avec /api/playlists/join)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/join', joinCodeLimiter, join);

/**
 * @swagger
 * /api/rooms/{id}:
 *   get:
 *     summary: Détail d'une salle
 *     description: >
 *       Une salle privée n'est visible que du propriétaire et des invités.
 *       inviteCode et invites ne sont renvoyés qu'au propriétaire.
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Salle
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Room' }
 *       403:
 *         description: ROOM_FORBIDDEN
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: ROOM_NOT_FOUND
 *   patch:
 *     summary: Modifier une salle (propriétaire)
 *     description: >
 *       Modifie nom, visibilité, licence et paramètres géo/horaires (mêmes validations qu'à la création,
 *       contrôlées sur la salle résultante ; `null` efface zone ou plage horaire). Passer en privé génère
 *       un code d'invitation et retire les abonnés temps réel non invités ; repasser en public supprime le code.
 *       Diffuse `room:updated`.
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateRoomInput' }
 *     responses:
 *       200:
 *         description: Salle mise à jour (avec myRole et permissions)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Room' }
 *       400:
 *         description: VALIDATION_ERROR ou GEO_CONFIG_REQUIRED
 *       403:
 *         description: NOT_ROOM_OWNER
 *       404:
 *         description: ROOM_NOT_FOUND
 *   delete:
 *     summary: Supprimer une salle (propriétaire)
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Salle supprimée avec ses titres, votes et invitations
 *       403:
 *         description: NOT_ROOM_OWNER
 *       404:
 *         description: ROOM_NOT_FOUND
 */
router.get('/:id', getOne);
router.patch('/:id', update);
router.delete('/:id', remove);

/**
 * @swagger
 * /api/rooms/{id}/invites:
 *   post:
 *     summary: Inviter un utilisateur (propriétaire)
 *     tags: [Rooms]
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
 *     responses:
 *       201:
 *         description: Invitation créée (idempotent)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/RoomInvite' }
 *       400:
 *         description: VALIDATION_ERROR
 *       403:
 *         description: NOT_ROOM_OWNER
 *       404:
 *         description: ROOM_NOT_FOUND ou USER_NOT_FOUND
 */
router.post('/:id/invites', invite);

/**
 * @swagger
 * /api/rooms/{id}/invite-code:
 *   post:
 *     summary: Régénérer le code d'invitation d'une salle privée (propriétaire)
 *     description: >
 *       Remplace le code d'invitation ; l'ancien code est immédiatement refusé
 *       (INVALID_INVITE_CODE). Les invités existants conservent leur accès.
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Nouveau code (10 caractères, alphabet sans I, O, 0, 1)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inviteCode: { type: string, example: 'K7QX2MZP9D' }
 *       403:
 *         description: NOT_ROOM_OWNER
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: ROOM_NOT_FOUND
 *       409:
 *         description: ROOM_NOT_PRIVATE (une salle publique n'a pas de code)
 */
router.post('/:id/invite-code', regenerateCode);

/**
 * @swagger
 * /api/rooms/{id}/invites/{userId}:
 *   delete:
 *     summary: Révoquer l'invitation d'un utilisateur (propriétaire)
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Invitation révoquée
 *       403:
 *         description: NOT_ROOM_OWNER
 *       404:
 *         description: ROOM_NOT_FOUND ou INVITE_NOT_FOUND
 */
router.delete('/:id/invites/:userId', removeInvite);

export default router;
