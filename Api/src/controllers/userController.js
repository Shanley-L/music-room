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
