import * as userService from '../services/userService.js';

export async function getMe(req, res) {
  const profile = await userService.getUserProfile(req.user.id, req.user.id);
  if (!profile) return res.status(404).json({ error: 'Utilisateur introuvable' });
  return res.json(profile);
}

export async function updateMe(req, res) {
  const updated = await userService.updateUserProfile(req.user.id, req.body);
  return res.json(updated);
}

export async function getProfile(req, res) {
  const profile = await userService.getUserProfile(req.params.id, req.user?.id);
  if (!profile) return res.status(404).json({ error: 'Utilisateur introuvable' });
  return res.json(profile);
}

export async function search(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2 || q.length > 100) {
    return res.status(400).json({
      error: 'q doit contenir entre 2 et 100 caractères',
      code: 'VALIDATION_ERROR',
    });
  }
  return res.json(await userService.searchUsers(q, req.user.id));
}
