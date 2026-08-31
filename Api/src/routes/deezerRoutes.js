import express from 'express';
import { discover, search } from '../controllers/deezerController.js';

const router = express.Router();

router.get('/discover', discover);
router.get('/search', search);

export default router;