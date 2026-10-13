import { Router } from 'express';
import { received } from '../controllers/delegationController.js';

// Mounted behind authMiddleware in app.js.
const router = Router();

/**
 * @swagger
 * /api/delegations/received:
 *   get:
 *     summary: Appareils dont le contrôle m'a été délégué
 *     description: Délégations actives reçues d'amis, avec le nom du propriétaire et mes droits sur chaque appareil.
 *     tags: [Devices]
 *     responses:
 *       200:
 *         description: Délégations reçues
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/DelegationRights'
 *                   - type: object
 *                     properties:
 *                       id: { type: string }
 *                       deviceId: { type: string }
 *                       device:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           name: { type: string }
 *                           platform: { type: string }
 *                       owner: { $ref: '#/components/schemas/PublicUser' }
 *                       createdAt: { type: string, format: date-time }
 *                       updatedAt: { type: string, format: date-time }
 *       401:
 *         description: Non authentifié
 */
router.get('/received', received);

export default router;
