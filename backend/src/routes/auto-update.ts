import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest, requireAdmin } from '../middleware/auth';

const router = Router();

/** When scope='connection', target_id must point to one of the user's own connections. */
async function ownsTargetConnection(userId: string | undefined, targetId: unknown): Promise<boolean> {
  if (!targetId) return false;
  const conn = await db('cloud_connections')
    .where({ id: targetId, user_id: userId })
    .first();
  return !!conn;
}

/** GET /auto-update-policies */
router.get('/', async (req: AuthRequest, res: Response) => {
  const policies = await db('auto_update_policies')
    .where({ user_id: req.userId })
    .orderBy('created_at', 'asc');
  res.json(policies);
});

/** POST /auto-update-policies */
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  const {
    name,
    scope = 'global',
    target_id = null,
    provider = null,
    enabled = true,
    interval_minutes = 60,
    sync_instances = true,
    sync_dns = false,
    sync_cost = true,
  } = req.body as Record<string, unknown>;

  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  if (scope === 'connection' && !(await ownsTargetConnection(req.userId, target_id))) {
    res.status(400).json({ error: 'target_id must reference one of your connections' });
    return;
  }

  const [policy] = await db('auto_update_policies')
    .insert({
      user_id: req.userId,
      name,
      scope,
      target_id,
      provider,
      enabled,
      interval_minutes,
      sync_instances,
      sync_dns,
      sync_cost,
      next_run_at: enabled
        ? new Date(Date.now() + (interval_minutes as number) * 60_000)
        : null,
    })
    .returning('*');

  res.status(201).json(policy);
});

/** PATCH /auto-update-policies/:id */
router.patch('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  const existing = await db('auto_update_policies')
    .where({ id: req.params.id, user_id: req.userId })
    .first();

  if (!existing) {
    res.status(404).json({ error: 'Policy not found' });
    return;
  }

  const allowed = [
    'name', 'enabled', 'interval_minutes',
    'sync_instances', 'sync_dns', 'sync_cost',
    'scope', 'target_id', 'provider',
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = (req.body as Record<string, unknown>)[key];
  }

  const nextScope = 'scope' in updates ? updates.scope : existing.scope;
  const nextTargetId = 'target_id' in updates ? updates.target_id : existing.target_id;
  if (nextScope === 'connection' && !(await ownsTargetConnection(req.userId, nextTargetId))) {
    res.status(400).json({ error: 'target_id must reference one of your connections' });
    return;
  }

  // If re-enabling or changing interval, reset next_run_at
  if ('enabled' in updates || 'interval_minutes' in updates) {
    const isEnabled = 'enabled' in updates ? updates.enabled : existing.enabled;
    const interval = 'interval_minutes' in updates
      ? (updates.interval_minutes as number)
      : existing.interval_minutes;
    updates.next_run_at = isEnabled ? new Date(Date.now() + interval * 60_000) : null;
    // Reset backoff when re-enabled
    if (updates.enabled === true) {
      updates.failure_count = 0;
      updates.last_error = null;
    }
  }

  const [updated] = await db('auto_update_policies')
    .where({ id: req.params.id, user_id: req.userId })
    .update(updates)
    .returning('*');

  res.json(updated);
});

/** DELETE /auto-update-policies/:id */
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  const deleted = await db('auto_update_policies')
    .where({ id: req.params.id, user_id: req.userId })
    .delete();

  if (!deleted) {
    res.status(404).json({ error: 'Policy not found' });
    return;
  }
  res.status(204).end();
});

/** GET /auto-update-policies/:id/runs — audit log for a policy */
router.get('/:id/runs', async (req: AuthRequest, res: Response) => {
  const policy = await db('auto_update_policies')
    .where({ id: req.params.id, user_id: req.userId })
    .first();

  if (!policy) {
    res.status(404).json({ error: 'Policy not found' });
    return;
  }

  const runs = await db('auto_update_runs')
    .where({ policy_id: req.params.id })
    .orderBy('started_at', 'desc')
    .limit(50)
    .select('id', 'status', 'error', 'connections_synced', 'started_at', 'finished_at');

  res.json(runs);
});

/** POST /auto-update-policies/:id/run — trigger immediately */
router.post('/:id/run', requireAdmin, async (req: AuthRequest, res: Response) => {
  const policy = await db('auto_update_policies')
    .where({ id: req.params.id, user_id: req.userId })
    .first();

  if (!policy) {
    res.status(404).json({ error: 'Policy not found' });
    return;
  }

  // Set next_run_at to now so the scheduler picks it up on the next tick
  await db('auto_update_policies').where({ id: policy.id, user_id: req.userId }).update({
    next_run_at: new Date(),
  });

  res.json({ status: 'queued', message: 'Policy will run within 60 seconds' });
});

export default router;
