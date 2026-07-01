export function authMiddleware(req, res, next) {
  const devUserId = req.headers['x-dev-user-id'];

  if (devUserId) {
    req.user = { id: devUserId };
    return next();
  }

  return res.status(401).json({ error: 'Non authentifié' });
}
