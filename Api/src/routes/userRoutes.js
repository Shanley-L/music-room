import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/me', requireAuth, (req, res) => {
  res.json({ 
    ok: true, 
    message: 'Welcome to the protected zone!',
    user: req.user 
  });
});

export default router;