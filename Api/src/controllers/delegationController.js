import { listReceived } from '../services/delegationService.js';

export async function received(req, res) {
  return res.json(await listReceived(req.user.id));
}
