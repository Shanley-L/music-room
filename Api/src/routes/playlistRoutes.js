import express from 'express';
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

router.get('/', getPlaylists);
router.post('/', createPlaylist);
router.post('/join', joinByCode);

router.get('/:id', getPlaylistById);
router.put('/:id', updatePlaylist);
router.delete('/:id', deletePlaylist);

router.post('/:id/tracks', addTrack);
router.delete('/:id/tracks/:trackId', removeTrack);
router.put('/:id/tracks/reorder', reorderTracks);

export default router;
