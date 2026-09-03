import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { create, listPublic, getOne, join, joinRoom, invite } from '../controllers/roomController.js';

const router = Router();

router.use(authMiddleware);

router.post('/', create);
router.get('/public', listPublic);
router.get('/:id', getOne);
router.post('/join', join);
router.post('/:id/join', joinRoom);
router.post('/:id/invites', invite);

export default router;
