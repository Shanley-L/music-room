import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { listTracks, suggest, vote, unvote, remove } from '../controllers/trackController.js';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   - name: Room tracks
 *     description: File d'attente et votes d'une salle
 *
 * components:
 *   schemas:
 *     Track:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         roomId: { type: string }
 *         externalId: { type: string }
 *         title: { type: string }
 *         artist: { type: string }
 *         album: { type: string, nullable: true }
 *         preview: { type: string, nullable: true }
 *         duration: { type: integer, nullable: true }
 *         voteCount: { type: integer }
 *         position: { type: integer, description: 'Position dans la file (1 = prochain titre)' }
 *         suggestedBy: { type: string }
 *         createdAt: { type: string, format: date-time }
 *     Queue:
 *       type: array
 *       description: Titres triés par votes décroissants puis par ancienneté
 *       items: { $ref: '#/components/schemas/Track' }
 */

/**
 * @swagger
 * /api/rooms/{roomId}/tracks:
 *   get:
 *     summary: File d'attente de la salle
 *     tags: [Room tracks]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Titres triés par position
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Queue' }
 *       403:
 *         description: ROOM_FORBIDDEN
 *       404:
 *         description: ROOM_NOT_FOUND
 *   post:
 *     summary: Suggérer un titre
 *     description: Toute personne ayant accès à la salle peut suggérer ; la licence ne s'applique qu'au vote.
 *     tags: [Room tracks]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
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
 *               preview: { type: string }
 *               duration: { type: integer }
 *     responses:
 *       201:
 *         description: Titre ajouté en fin de file
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Track' }
 *       400:
 *         description: VALIDATION_ERROR
 *       403:
 *         description: ROOM_FORBIDDEN
 *       409:
 *         description: TRACK_ALREADY_IN_QUEUE
 */
router.get('/', listTracks);
router.post('/', suggest);

/**
 * @swagger
 * /api/rooms/{roomId}/tracks/{trackId}:
 *   delete:
 *     summary: Supprimer un titre de la file (propriétaire)
 *     tags: [Room tracks]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
 *       - { in: path, name: trackId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: File mise à jour
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 queue: { $ref: '#/components/schemas/Queue' }
 *       403:
 *         description: ROOM_FORBIDDEN ou NOT_ROOM_OWNER
 *       404:
 *         description: ROOM_NOT_FOUND ou TRACK_NOT_FOUND
 */
router.delete('/:trackId', remove);

/**
 * @swagger
 * /api/rooms/{roomId}/tracks/{trackId}/vote:
 *   post:
 *     summary: Voter pour un titre
 *     description: >
 *       Vote atomique, sérialisé par salle : les votes simultanés sont tous pris en compte.
 *       Licence INVITED_ONLY : seuls le propriétaire et les invités votent.
 *       Licence GEO_TIME_RESTRICTED : le vote doit avoir lieu dans la plage horaire et, si une zone est définie,
 *       le client envoie sa position.
 *     tags: [Room tracks]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
 *       - { in: path, name: trackId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200:
 *         description: Vote enregistré
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 track: { $ref: '#/components/schemas/Track' }
 *                 queue: { $ref: '#/components/schemas/Queue' }
 *       400:
 *         description: VALIDATION_ERROR ou LOCATION_REQUIRED
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: ROOM_FORBIDDEN, NOT_INVITED, OUT_OF_ZONE ou OUT_OF_TIME_WINDOW
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: ROOM_NOT_FOUND ou TRACK_NOT_FOUND
 *       409:
 *         description: ALREADY_VOTED
 *       503:
 *         description: ROOM_BUSY (trop de requêtes simultanées sur la salle, réessayer)
 *   delete:
 *     summary: Retirer son vote
 *     tags: [Room tracks]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
 *       - { in: path, name: trackId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Vote retiré
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 queue: { $ref: '#/components/schemas/Queue' }
 *       403:
 *         description: ROOM_FORBIDDEN
 *       404:
 *         description: ROOM_NOT_FOUND, TRACK_NOT_FOUND ou VOTE_NOT_FOUND
 */
router.post('/:trackId/vote', vote);
router.delete('/:trackId/vote', unvote);

export default router;
