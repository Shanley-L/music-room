import express from 'express';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';
import {
  getPlaylists,
  getPlaylistById,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTrack,
  removeTrack,
  reorderTracks,
  joinByCode,
} from '../controllers/playlistController.js';

const router = express.Router();

router.get('/', optionalAuth, getPlaylists);
router.post('/', authMiddleware, createPlaylist);
router.post('/join', authMiddleware, joinByCode);

router.get('/:id', optionalAuth, getPlaylistById);
router.put('/:id', authMiddleware, updatePlaylist);
router.delete('/:id', authMiddleware, deletePlaylist);

router.post('/:id/tracks', authMiddleware, addTrack);
router.delete('/:id/tracks/:trackId', authMiddleware, removeTrack);
router.put('/:id/tracks/reorder', authMiddleware, reorderTracks);

export default router;
