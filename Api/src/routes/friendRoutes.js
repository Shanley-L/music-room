import { Router } from 'express';
import {
  createRequest,
  requests,
  accept,
  removeRequest,
  list,
  remove,
} from '../controllers/friendController.js';

// Mounted behind authMiddleware in app.js.
const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Friends
 *     description: Amitiés (prérequis de la délégation de contrôle)
 *
 * components:
 *   schemas:
 *     PublicUser:
 *       type: object
 *       description: Identité publique uniquement (jamais d'email ni de champ privé)
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *     FriendRequest:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         status: { type: string, enum: [PENDING, ACCEPTED] }
 *         direction: { type: string, enum: [INCOMING, OUTGOING], description: "Du point de vue de l'appelant" }
 *         user: { $ref: '#/components/schemas/PublicUser' }
 *         createdAt: { type: string, format: date-time }
 */

/**
 * @swagger
 * /api/friends:
 *   get:
 *     summary: Lister mes amis
 *     tags: [Friends]
 *     responses:
 *       200:
 *         description: Amis acceptés
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/PublicUser' }
 *       401:
 *         description: Non authentifié
 */
router.get('/', list);

/**
 * @swagger
 * /api/friends/requests:
 *   post:
 *     summary: Envoyer une demande d'ami
 *     tags: [Friends]
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
 *         description: Demande créée (PENDING)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FriendRequest' }
 *       200:
 *         description: L'autre utilisateur avait déjà une demande en attente vers l'appelant, elle est acceptée (ACCEPTED)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FriendRequest' }
 *       400:
 *         description: Entrée invalide (VALIDATION_ERROR) ou demande à soi-même (CANNOT_FRIEND_SELF)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Utilisateur introuvable (USER_NOT_FOUND)
 *       409:
 *         description: Demande déjà envoyée par l'appelant, ou déjà amis (FRIENDSHIP_EXISTS)
 *   get:
 *     summary: Lister mes demandes en attente
 *     tags: [Friends]
 *     responses:
 *       200:
 *         description: Demandes reçues et envoyées
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 incoming:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/FriendRequest' }
 *                 outgoing:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/FriendRequest' }
 */
router.post('/requests', createRequest);
router.get('/requests', requests);

/**
 * @swagger
 * /api/friends/requests/{id}/accept:
 *   post:
 *     summary: Accepter une demande d'ami
 *     description: Seul le destinataire peut accepter. Les deux utilisateurs deviennent amis.
 *     tags: [Friends]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Demande acceptée
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FriendRequest' }
 *       403:
 *         description: L'appelant est l'émetteur de la demande (NOT_REQUEST_ADDRESSEE)
 *       404:
 *         description: Demande introuvable (FRIEND_REQUEST_NOT_FOUND)
 *       409:
 *         description: Déjà amis (FRIENDSHIP_EXISTS)
 */
router.post('/requests/:id/accept', accept);

/**
 * @swagger
 * /api/friends/requests/{id}:
 *   delete:
 *     summary: Refuser (destinataire) ou annuler (émetteur) une demande en attente
 *     tags: [Friends]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Demande supprimée
 *       404:
 *         description: Demande en attente introuvable (FRIEND_REQUEST_NOT_FOUND)
 */
router.delete('/requests/:id', removeRequest);

/**
 * @swagger
 * /api/friends/{userId}:
 *   delete:
 *     summary: Retirer un ami
 *     description: >
 *       Révoque aussitôt toutes les délégations entre les deux utilisateurs (dans les deux sens) :
 *       les sockets des délégués ne reçoivent plus l'état des appareils concernés et reçoivent
 *       `device:revoked { deviceId, reason: 'UNFRIENDED' }`.
 *     tags: [Friends]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *     responses:
 *       204:
 *         description: Amitié supprimée
 *       404:
 *         description: Pas ami avec cet utilisateur (NOT_FRIENDS)
 */
router.delete('/:userId', remove);

export default router;
