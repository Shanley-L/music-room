import { Router } from 'express';
import * as userController from '../controllers/userController.js';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';

const router = Router();

router.get('/me', authMiddleware, userController.getMe);
router.put('/me', authMiddleware, userController.updateMe);
router.get('/:id', optionalAuth, userController.getProfile);

export default router;
