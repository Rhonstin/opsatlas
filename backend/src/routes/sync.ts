import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest, requireAdmin } from '../middleware/auth';
import { syncConnectionInstances } from '../lib/sync-runner';

const router = Router();

/**
 * POST /sync/:connection_id
 * Trigger a manual sync for a connection. Runs GCP fetch, upserts instances.
 */
router.post('/:connection_id', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { connection_id } = req.params;

  const conn = await db('cloud_connections')
    .where({ id: connection_id, user_id: req.userId })
    .first();

  if (!conn) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }

  if (!['gcp', 'hetzner', 'aws', 'coolify'].includes(conn.provider)) {
    res.status(400).json({ error: 'Sync not supported for this provider' });
    return;
  }

  // Create a sync_run record
  const [run] = await db('sync_runs')
    .insert({ connection_id, status: 'running' })
    .returning('*');

  // Respond immediately — sync runs in background
  res.status(202).json({ sync_run_id: run.id, status: 'running' });

  // Run sync async (fire-and-forget, result is stored in DB)
  runSync(conn, run.id).catch(() => {/* already handled inside */});
});

async function runSync(conn: Record<string, string>, runId: string) {
  try {
    // Shared with the scheduler: converts costs to preferred currency and
    // prunes instances that disappeared from the provider.
    await syncConnectionInstances(conn);
    await db('sync_runs').where({ id: runId }).update({ status: 'success', finished_at: new Date() });
    // syncConnectionInstances already set the connection status to active.
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db('sync_runs').where({ id: runId }).update({ status: 'error', finished_at: new Date(), error_log: message });
    // connection status was set to error inside syncConnectionInstances
  }
}

/**
 * GET /sync/history
 * Return recent sync runs for all connections owned by the user.
 */
router.get('/history', async (req: AuthRequest, res: Response) => {
  const runs = await db('sync_runs')
    .join('cloud_connections', 'sync_runs.connection_id', 'cloud_connections.id')
    .where('cloud_connections.user_id', req.userId)
    .select(
      'sync_runs.id',
      'sync_runs.connection_id',
      'cloud_connections.name as connection_name',
      'cloud_connections.provider',
      'sync_runs.status',
      'sync_runs.started_at',
      'sync_runs.finished_at',
      'sync_runs.error_log',
    )
    .orderBy('sync_runs.started_at', 'desc')
    .limit(50);

  res.json(runs);
});

/**
 * GET /sync/:run_id
 * Poll a specific sync run status.
 */
router.get('/:run_id', async (req: AuthRequest, res: Response) => {
  const run = await db('sync_runs')
    .join('cloud_connections', 'sync_runs.connection_id', 'cloud_connections.id')
    .where('sync_runs.id', req.params.run_id)
    .where('cloud_connections.user_id', req.userId)
    .select(
      'sync_runs.id',
      'sync_runs.connection_id',
      'sync_runs.status',
      'sync_runs.started_at',
      'sync_runs.finished_at',
      'sync_runs.error_log',
    )
    .first();

  if (!run) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(run);
});

export default router;
