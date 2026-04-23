import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

/** GET /favorites — list all favorited instances for the current user */
router.get('/', async (req: AuthRequest, res: Response) => {
  const rows = await db('favorite_instances')
    .join('instances', 'favorite_instances.instance_id', 'instances.id')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .where('favorite_instances.user_id', req.userId)
    .where('cloud_connections.user_id', req.userId)
    .select(
      'instances.id',
      'instances.provider',
      'instances.resource_type',
      'instances.connection_id',
      'cloud_connections.name as connection_name',
      'instances.instance_id',
      'instances.name',
      'instances.status',
      'instances.region',
      'instances.zone',
      'instances.public_ip',
      'instances.private_ip',
      'instances.instance_type',
      'instances.launched_at',
      'instances.estimated_hourly_cost',
      'instances.estimated_monthly_cost',
      'favorite_instances.created_at as favorited_at',
    )
    .orderBy('favorite_instances.created_at', 'desc');

  res.json(rows);
});

/** POST /favorites/:instance_id — add a favorite */
router.post('/:instance_id', async (req: AuthRequest, res: Response) => {
  // Verify the instance belongs to this user
  const inst = await db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .where('instances.id', req.params.instance_id)
    .where('cloud_connections.user_id', req.userId)
    .select('instances.id')
    .first();

  if (!inst) {
    res.status(404).json({ error: 'Instance not found' });
    return;
  }

  await db('favorite_instances')
    .insert({ user_id: req.userId, instance_id: req.params.instance_id })
    .onConflict(['user_id', 'instance_id'])
    .ignore();

  res.status(201).json({ ok: true });
});

/** DELETE /favorites/:instance_id — remove a favorite */
router.delete('/:instance_id', async (req: AuthRequest, res: Response) => {
  await db('favorite_instances')
    .where({ user_id: req.userId, instance_id: req.params.instance_id })
    .delete();

  res.status(204).send();
});

export default router;
