import express from 'express';
import { discover } from '../controllers/deezerController.js'

const router = express.Router();

router.get('/discover', discover)

export default router