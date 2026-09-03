import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { listTracks, suggest, vote, unvote, remove } from '../controllers/trackController.js';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/', listTracks);
router.post('/', suggest);
router.delete('/:trackId', remove);
router.post('/:trackId/vote', vote);
router.delete('/:trackId/vote', unvote);

export default router;
