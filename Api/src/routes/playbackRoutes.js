import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { playbackLimiter } from '../middleware/rateLimit.js';
import { getState, play, pause, resume, skip, ended } from '../controllers/playbackController.js';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

/**
 * @swagger
 * components:
 *   schemas:
 *     PlaybackState:
 *       type: object
 *       description: >
 *         État de lecture d'une salle, identique pour tous. Position attendue d'un client :
 *         `positionMs` à `serverTime` ; en lecture, `now + (serverTime - horloge locale) - startedAt`.
 *       properties:
 *         roomId: { type: string }
 *         status: { type: string, enum: [IDLE, PLAYING, PAUSED] }
 *         currentTrack:
 *           type: object
 *           nullable: true
 *           description: Titre courant (champs Track + durationMs, 30 s par défaut et au plus)
 *         startedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Heure serveur à laquelle la position 0 aurait été atteinte (null hors lecture)
 *         positionMs: { type: integer }
 *         serverTime: { type: string, format: date-time }
 */

/**
 * @swagger
 * /api/rooms/{roomId}/playback:
 *   get:
 *     summary: État de lecture de la salle
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: État de lecture
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PlaybackState' }
 *       403:
 *         description: ROOM_FORBIDDEN
 *       404:
 *         description: ROOM_NOT_FOUND
 */
router.get('/', getState);

/**
 * @swagger
 * /api/rooms/{roomId}/playback/play:
 *   post:
 *     summary: Démarrer la lecture (propriétaire)
 *     description: >
 *       Salle au repos (IDLE) : joue le titre en tête de la file (votes décroissants, puis plus ancien).
 *       Salle en pause : reprend. Déjà en lecture : sans effet. Idempotent.
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: État complet après transition (diffusé en `playback:updated`)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PlaybackState' }
 *       403:
 *         description: NOT_ROOM_OWNER ou ROOM_FORBIDDEN
 *       404:
 *         description: ROOM_NOT_FOUND
 *       409:
 *         description: NOTHING_TO_PLAY (file vide)
 *       429:
 *         description: RATE_LIMITED
 */
router.post('/play', playbackLimiter, play);

/**
 * @swagger
 * /api/rooms/{roomId}/playback/pause:
 *   post:
 *     summary: Mettre en pause (propriétaire)
 *     description: Fige la position. Déjà en pause : sans effet.
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: État complet après transition
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PlaybackState' }
 *       403:
 *         description: NOT_ROOM_OWNER
 *       409:
 *         description: NOTHING_PLAYING
 */
router.post('/pause', playbackLimiter, pause);

/**
 * @swagger
 * /api/rooms/{roomId}/playback/resume:
 *   post:
 *     summary: Reprendre la lecture (propriétaire)
 *     description: Reprend à la position figée. Déjà en lecture : sans effet.
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: État complet après transition
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PlaybackState' }
 *       403:
 *         description: NOT_ROOM_OWNER
 *       409:
 *         description: NOTHING_PLAYING
 */
router.post('/resume', playbackLimiter, resume);

/**
 * @swagger
 * /api/rooms/{roomId}/playback/skip:
 *   post:
 *     summary: Passer au titre suivant (propriétaire)
 *     description: Marque le titre courant comme joué et joue la tête de file, ou revient au repos si la file est vide. Au repos : sans effet.
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: État complet après transition
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PlaybackState' }
 *       403:
 *         description: NOT_ROOM_OWNER
 */
router.post('/skip', playbackLimiter, skip);

/**
 * @swagger
 * /api/rooms/{roomId}/playback/ended:
 *   post:
 *     summary: Signaler la fin du titre courant (tout membre ayant accès)
 *     description: >
 *       Accepté seulement si `trackId` est le titre en cours de lecture et si sa durée est écoulée
 *       (tolérance 2 s) ; sinon sans effet (renvoie l'état courant). Idempotent : N clients
 *       qui signalent la même fin font avancer la salle une seule fois.
 *     tags: [Rooms]
 *     parameters:
 *       - { in: path, name: roomId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [trackId]
 *             properties:
 *               trackId: { type: string }
 *     responses:
 *       200:
 *         description: État complet courant
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PlaybackState' }
 *       400:
 *         description: VALIDATION_ERROR
 *       403:
 *         description: ROOM_FORBIDDEN
 */
router.post('/ended', playbackLimiter, ended);

export default router;
