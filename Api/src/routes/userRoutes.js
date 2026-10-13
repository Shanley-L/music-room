import { Router } from 'express';
import * as userController from '../controllers/userController.js';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';
import { userSearchLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.get('/me', authMiddleware, userController.getMe);
router.put('/me', authMiddleware, userController.updateMe);
/**
 * @swagger
 * /api/users/search:
 *   get:
 *     summary: Rechercher des utilisateurs par nom (pour ajouter des amis)
 *     description: Renvoie au plus 20 utilisateurs `{ id, name }` dont le nom contient `q` (insensible à la casse), sans l'appelant. Jamais d'email ni de champ privé.
 *     tags: [Friends]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 2, maxLength: 100 }
 *     responses:
 *       429:
 *         description: RATE_LIMITED
 *       200:
 *         description: Utilisateurs trouvés
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/PublicUser' }
 *       400:
 *         description: q trop court ou trop long (VALIDATION_ERROR)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: Non authentifié
 */
router.get('/search', authMiddleware, userSearchLimiter, userController.search);
router.get('/:id', optionalAuth, userController.getProfile);

export default router;
