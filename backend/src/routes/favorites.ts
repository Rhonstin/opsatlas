import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

/** GET /favorites — list favorite instance IDs for the current user */
router.get('/', async (req: AuthRequest, res: Response) => {
  const favorites = await db('favorite_instances')
    .where({ user_id: req.userId })
    .pluck('instance_id');
  res.json(favorites);
});

/** POST /instances/:id/favorite — add to favorites */
router.post('/instances/:id/favorite', async (req: AuthRequest, res: Response) => {
  const instanceId = req.params.id;

  // Verify the instance exists and is visible to the user
  const inst = await db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .where('instances.id', instanceId)
    .where('cloud_connections.user_id', req.userId)
    .first();

  if (!inst) {
    res.status(404).json({ error: 'Instance not found' });
    return;
  }

  await db('favorite_instances')
    .insert({ user_id: req.userId, instance_id: instanceId })
    .onConflict(['user_id', 'instance_id'])
    .ignore();

  res.json({ ok: true });
});

/** DELETE /instances/:id/favorite — remove from favorites */
router.delete('/instances/:id/favorite', async (req: AuthRequest, res: Response) => {
  await db('favorite_instances')
    .where({ user_id: req.userId, instance_id: req.params.id })
    .delete();
  res.json({ ok: true });
});

export default router;
