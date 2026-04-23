import { Router, Response } from 'express';
import db from '../db';
import { decrypt } from '../lib/crypto';
import { listGcpInstances } from '../gcp/sync';
import { listCloudSqlInstances } from '../gcp/cloudsql';
import { refreshBillingCache, loadPriceCache, isCacheStale } from '../gcp/billing';
import { listHetznerServers } from '../hetzner/sync';
import { listAwsInstances } from '../aws/ec2';
import { AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * POST /sync/:connection_id
 * Trigger a manual sync for a connection. Runs GCP fetch, upserts instances.
 */
router.post('/:connection_id', async (req: AuthRequest, res: Response) => {
  const { connection_id } = req.params;

  const conn = await db('cloud_connections')
    .where({ id: connection_id, user_id: req.userId })
    .first();

  if (!conn) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }

  if (!['gcp', 'hetzner', 'aws'].includes(conn.provider)) {
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
    const credentials = JSON.parse(decrypt(conn.credentials_enc)) as Record<string, unknown>;

    if (conn.provider === 'gcp') {
      await syncGcp(conn, credentials);
    } else if (conn.provider === 'hetzner') {
      await syncHetzner(conn, credentials);
    } else if (conn.provider === 'aws') {
      await syncAws(conn, credentials);
    }

    await db('sync_runs').where({ id: runId }).update({ status: 'success', finished_at: new Date() });
    await db('cloud_connections').where({ id: conn.id }).update({ status: 'active', last_sync_at: new Date(), last_error: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db('sync_runs').where({ id: runId }).update({ status: 'error', finished_at: new Date(), error_log: message });
    await db('cloud_connections').where({ id: conn.id }).update({ status: 'error', last_error: message });
  }
}

async function syncGcp(conn: Record<string, string>, credentials: Record<string, unknown>) {
  let priceCache: Map<string, number> | undefined;
  try {
    if (await isCacheStale(db)) await refreshBillingCache(credentials, db);
    priceCache = await loadPriceCache(db);
  } catch { /* Non-fatal: fall back to static rate tables */ }

  const savedProjects = await db('projects_or_accounts')
    .where({ connection_id: conn.id })
    .select('id', 'external_id');

  const projectsToSync: Array<{ id: string | null; externalId: string }> =
    savedProjects.length
      ? savedProjects.map((p: { id: string; external_id: string }) => ({ id: p.id, externalId: p.external_id }))
      : [{ id: null, externalId: (credentials.project_id as string) || conn.name }];

  const errors: string[] = [];

  for (const project of projectsToSync) {
    try {
      const instances = await listGcpInstances(project.externalId, credentials, priceCache);
      for (const inst of instances) {
        await upsertInstance({ ...inst, provider: 'gcp', connectionId: conn.id, projectId: project.id });
      }
      console.log(`[sync] GCP project ${project.externalId}: ${instances.length} instances`);
      if (project.id) {
        await db('projects_or_accounts')
          .where({ id: project.id })
          .update({ last_sync_at: new Date(), last_error: null });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[sync] GCP project ${project.externalId} skipped: ${msg.split('\n')[0]}`);
      errors.push(`${project.externalId}: ${msg.split('\n')[0]}`);
      if (project.id) {
        await db('projects_or_accounts')
          .where({ id: project.id })
          .update({ last_error: msg.split('\n')[0] });
      }
    }
  }

  // Only fail if every project errored — partial success is acceptable
  if (errors.length > 0 && errors.length === projectsToSync.length) {
    throw new Error(`All projects failed:\n${errors.join('\n')}`);
  }

  // Cloud SQL instances (per project, non-fatal if API not enabled)
  for (const project of projectsToSync) {
    try {
      const sqlInstances = await listCloudSqlInstances(project.externalId, credentials);
      for (const inst of sqlInstances) {
        await upsertInstance({ ...inst, provider: 'gcp', resourceType: 'cloudsql', connectionId: conn.id, projectId: project.id });
      }
      if (sqlInstances.length > 0) {
        console.log(`[sync] Cloud SQL project ${project.externalId}: ${sqlInstances.length} instances`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[sync] Cloud SQL project ${project.externalId} skipped: ${msg.split('\n')[0]}`);
    }
  }
}

async function syncHetzner(conn: Record<string, string>, credentials: Record<string, unknown>) {
  const servers = await listHetznerServers(credentials.token as string);
  for (const inst of servers) {
    await upsertInstance({ ...inst, provider: 'hetzner', connectionId: conn.id, projectId: null });
  }
}

async function syncAws(conn: Record<string, string>, credentials: Record<string, unknown>) {
  const instances = await listAwsInstances(credentials);
  for (const inst of instances) {
    await upsertInstance({ ...inst, provider: 'aws', connectionId: conn.id, projectId: null });
  }
  console.log(`[sync] AWS ${conn.name}: ${instances.length} instances`);
}

async function upsertInstance(inst: {
  provider: string;
  resourceType?: string;
  connectionId: string;
  projectId: string | null;
  instanceId: string;
  name: string;
  status: string;
  region: string;
  zone: string;
  privateIp: string | null;
  publicIp: string | null;
  machineType: string;
  launchedAt: Date | null;
  estimatedHourlyCost: number;
  estimatedMonthlyCost: number;
  rawPayload: Record<string, unknown>;
}) {
  await db('instances')
    .insert({
      provider: inst.provider,
      resource_type: inst.resourceType ?? 'compute',
      connection_id: inst.connectionId,
      project_or_account_id: inst.projectId,
      instance_id: inst.instanceId,
      name: inst.name,
      status: inst.status,
      region: inst.region,
      zone: inst.zone,
      private_ip: inst.privateIp,
      public_ip: inst.publicIp,
      instance_type: inst.machineType,
      launched_at: inst.launchedAt,
      last_seen_at: new Date(),
      estimated_hourly_cost: inst.estimatedHourlyCost,
      estimated_monthly_cost: inst.estimatedMonthlyCost,
      raw_payload: JSON.stringify(inst.rawPayload),
    })
    .onConflict(['connection_id', 'instance_id'])
    .merge([
      'name', 'status', 'region', 'zone',
      'private_ip', 'public_ip', 'instance_type',
      'launched_at', 'last_seen_at',
      'estimated_hourly_cost', 'estimated_monthly_cost',
      'project_or_account_id', 'resource_type', 'raw_payload', 'updated_at',
    ]);
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
