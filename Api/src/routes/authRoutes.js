import { Router } from 'express';
import * as authController from '../controllers/authController.js';
import { authMiddleware } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authMiddleware, authController.logout);
router.post('/verify-email', authLimiter, authController.verifyEmail);

/**
 * @swagger
 * components:
 *   schemas:
 *     GoogleToken:
 *       type: object
 *       description: >
 *         Jeton délivré par Google à l'application. `idToken` est préféré ; `accessToken`
 *         (alias `token`) est accepté. Le serveur le vérifie auprès de Google (signature,
 *         expiration) et exige que son audience (`aud`/`azp`) soit l'un des client ids
 *         configurés (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_ID_ANDROID/_IOS/_WEB).
 *       properties:
 *         idToken: { type: string }
 *         accessToken: { type: string }
 *     AuthSession:
 *       type: object
 *       properties:
 *         user: { type: object }
 *         accessToken: { type: string }
 *         refreshToken: { type: string }
 */

/**
 * @swagger
 * /api/auth/providers:
 *   get:
 *     summary: Fournisseurs de connexion disponibles
 *     description: "`google` : au moins un client id Google est configuré. `devOAuth` : la connexion Google simulée (dev uniquement) est active."
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: Fournisseurs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 google: { type: boolean }
 *                 devOAuth: { type: boolean }
 */
router.get('/providers', authController.providers);

/**
 * @swagger
 * /api/auth/google:
 *   post:
 *     summary: Connexion / inscription avec Google
 *     description: >
 *       Vérifie le jeton Google côté serveur. Un compte Google déjà connu se connecte.
 *       Sinon l'email Google doit être vérifié : un compte existant avec cet email est
 *       lié au compte Google (si cet email n'avait jamais été validé, son mot de passe
 *       est supprimé), sinon un compte est créé.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/GoogleToken' }
 *     responses:
 *       200:
 *         description: Session ouverte
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       400:
 *         description: GOOGLE_TOKEN_REQUIRED
 *       401:
 *         description: INVALID_GOOGLE_TOKEN (signature, expiration ou audience invalide) ou GOOGLE_EMAIL_UNVERIFIED
 *       409:
 *         description: GOOGLE_ACCOUNT_CONFLICT (le compte de cet email est lié à un autre compte Google)
 *       429:
 *         description: RATE_LIMITED
 *       502:
 *         description: GOOGLE_UNAVAILABLE
 *       503:
 *         description: GOOGLE_NOT_CONFIGURED
 */
router.post('/google', authLimiter, authController.googleAuth);

/**
 * @swagger
 * /api/auth/link-google:
 *   post:
 *     summary: Lier un compte Google au compte connecté
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/GoogleToken' }
 *     responses:
 *       200:
 *         description: Compte lié, renvoie `{ user }`
 *       400:
 *         description: GOOGLE_TOKEN_REQUIRED
 *       401:
 *         description: Non authentifié ou INVALID_GOOGLE_TOKEN
 *       403:
 *         description: EMAIL_NOT_VERIFIED (l'email du compte doit être validé avant de lier Google)
 *       409:
 *         description: GOOGLE_ACCOUNT_IN_USE (ce compte Google appartient à un autre utilisateur) ou GOOGLE_ALREADY_LINKED (un autre compte Google est déjà lié)
 *       429:
 *         description: RATE_LIMITED
 *       503:
 *         description: GOOGLE_NOT_CONFIGURED
 */
router.post('/link-google', authMiddleware, authLimiter, authController.linkGoogle);

/**
 * @swagger
 * /api/auth/oauth:
 *   post:
 *     summary: "[DEV] Connexion Google simulée"
 *     description: >
 *       Développement local uniquement : active seulement si ALLOW_DEV_OAUTH=true et
 *       NODE_ENV vaut exactement development ou test, sinon 404. L'identité vient du corps de la
 *       requête et n'est donc pas une preuve ; un email déjà utilisé est refusé (409).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, providerId]
 *             properties:
 *               provider: { type: string, enum: [google] }
 *               providerId: { type: string, pattern: '^[A-Za-z0-9_.-]{1,64}$' }
 *               email: { type: string }
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Session ouverte
 *       404:
 *         description: NOT_FOUND (flag dev désactivé ou NODE_ENV hors development/test)
 *       409:
 *         description: EMAIL_IN_USE
 */
router.post('/oauth', authLimiter, authController.oauthLogin);

/**
 * @swagger
 * /api/auth/link-oauth:
 *   post:
 *     summary: "[DEV] Liaison Google simulée"
 *     description: Même condition que /api/auth/oauth (404 sinon).
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, providerId]
 *             properties:
 *               provider: { type: string, enum: [google] }
 *               providerId: { type: string }
 *     responses:
 *       200:
 *         description: Compte lié
 *       404:
 *         description: NOT_FOUND (flag dev désactivé ou NODE_ENV hors development/test)
 *       409:
 *         description: GOOGLE_ACCOUNT_IN_USE
 */
router.post('/link-oauth', authMiddleware, authLimiter, authController.linkOAuth);

router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/reset-password', authLimiter, authController.resetPassword);

export default router;
