/**
 * Auto-update scheduler.
 * Ticks every 60 s, finds policies whose next_run_at is overdue, and fires syncs.
 * Reuses runGcpSync / runDnsSync logic from the respective route modules.
 */
import db from './db';
import { decrypt } from './lib/crypto';
import { listGcpInstances } from './gcp/sync';
import { refreshBillingCache, loadPriceCache, isCacheStale } from './gcp/billing';
import { listHetznerServers } from './hetzner/sync';
import { listAwsInstances } from './aws/ec2';
import { listCloudSqlInstances } from './gcp/cloudsql';
import { listCloudflareZones, listCloudflareRecords } from './dns/cloudflare';
import { runBillingForConnections, currentPeriod } from './lib/billing-refresh';

const TICK_MS = 60_000;

// Max backoff: 24 h
const MAX_BACKOFF_MINUTES = 24 * 60;

export function startScheduler(): void {
  console.log('[scheduler] started — tick every 60 s');
  setInterval(tick, TICK_MS);
}

async function tick(): Promise<void> {
  try {
    const now = new Date();
    const due = await db('auto_update_policies')
      .where('enabled', true)
      .where('next_run_at', '<=', now)
      .select('*');

    for (const policy of due) {
      runPolicy(policy).catch((err: unknown) => {
        console.error(`[scheduler] uncaught error for policy ${policy.id}:`, err);
      });
    }
  } catch (err) {
    console.error('[scheduler] tick error:', err);
  }
}

async function runPolicy(policy: Record<string, unknown>): Promise<void> {
  const startedAt = new Date();

  await db('auto_update_policies').where({ id: policy.id }).update({
    last_status: 'running',
  });

  // Insert a run record immediately so it appears in the audit log
  const [run] = await db('auto_update_runs')
    .insert({ policy_id: policy.id, status: 'running', started_at: startedAt })
    .returning('*');

  try {
    const connections = await getTargetConnections(policy);

    for (const conn of connections) {
      if (policy.sync_instances) await syncInstances(conn);
      if (policy.sync_dns) await syncDns(conn);
    }

    if (policy.sync_cost) {
      const period = currentPeriod();
      const billingResults = await runBillingForConnections(connections, period);
      const errors = billingResults.filter((r) => r.status === 'error');
      if (errors.length > 0) {
        console.warn(`[scheduler] policy "${policy.name}" billing errors:`, errors.map((r) => `${r.connection_name}: ${r.message}`).join(', '));
      } else {
        const ok = billingResults.filter((r) => r.status === 'ok');
        const totalRows = ok.reduce((s, r) => s + (r.rows_upserted ?? 0), 0);
        console.log(`[scheduler] policy "${policy.name}" billing: ${totalRows} rows upserted for ${period}`);
      }
    }

    const now = new Date();
    await db('auto_update_policies').where({ id: policy.id }).update({
      last_run_at: now,
      next_run_at: nextRunAt(policy.interval_minutes as number, 0),
      last_status: 'success',
      last_error: null,
      failure_count: 0,
    });

    await db('auto_update_runs').where({ id: run.id }).update({
      status: 'success',
      connections_synced: connections.length,
      finished_at: now,
    });

    console.log(`[scheduler] policy "${policy.name}" completed (${connections.length} connections)`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const failures = (policy.failure_count as number) + 1;
    const backoffMinutes = Math.min(
      (policy.interval_minutes as number) * Math.pow(2, failures),
      MAX_BACKOFF_MINUTES,
    );

    const now = new Date();
    await db('auto_update_policies').where({ id: policy.id }).update({
      last_run_at: now,
      next_run_at: nextRunAt(backoffMinutes, 0),
      last_status: 'error',
      last_error: message,
      failure_count: failures,
    });

    await db('auto_update_runs').where({ id: run.id }).update({
      status: 'error',
      error: message,
      finished_at: now,
    });

    console.error(`[scheduler] policy "${policy.name}" failed (backoff ${backoffMinutes} min):`, message);
  }
}

function nextRunAt(intervalMinutes: number, extraMs = 0): Date {
  return new Date(Date.now() + intervalMinutes * 60_000 + extraMs);
}

async function getTargetConnections(policy: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const q = db('cloud_connections');

  if (policy.scope === 'connection' && policy.target_id) {
    q.where({ id: policy.target_id });
  } else if (policy.scope === 'provider' && policy.provider) {
    q.where({ provider: policy.provider });
  }
  // global: no filter — all connections for all users
  // (policy is user-scoped via user_id, so we need to join)
  q.where({ user_id: policy.user_id });

  return q.select('*');
}

async function syncInstances(conn: Record<string, unknown>): Promise<void> {
  const credentials = JSON.parse(decrypt(conn.credentials_enc as string)) as Record<string, unknown>;

  if (conn.provider === 'gcp') {
    let priceCache: Map<string, number> | undefined;
    try {
      if (await isCacheStale(db)) await refreshBillingCache(credentials, db);
      priceCache = await loadPriceCache(db);
    } catch { /* non-fatal */ }

    const savedProjects = await db('projects_or_accounts')
      .where({ connection_id: conn.id })
      .select('id', 'external_id');

    const projects = savedProjects.length
      ? savedProjects.map((p: { id: string; external_id: string }) => ({ id: p.id, externalId: p.external_id }))
      : [{ id: null, externalId: (credentials.project_id as string) || conn.name }];

    for (const project of projects) {
      try {
        const instances = await listGcpInstances(project.externalId as string, credentials, priceCache);
        for (const inst of instances) {
          await upsertInstanceRow({ ...inst, provider: 'gcp', connectionId: conn.id as string, projectId: project.id as string | null });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[scheduler] GCP project ${project.externalId} skipped: ${msg.split('\n')[0]}`);
      }
    }
    // Cloud SQL (non-fatal if API not enabled)
    for (const project of projects) {
      try {
        const sqlInstances = await listCloudSqlInstances(project.externalId as string, credentials);
        for (const inst of sqlInstances) {
          await upsertInstanceRow({ ...inst, provider: 'gcp', resourceType: 'cloudsql', connectionId: conn.id as string, projectId: project.id as string | null });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[scheduler] Cloud SQL project ${project.externalId} skipped: ${msg.split('\n')[0]}`);
      }
    }
  } else if (conn.provider === 'hetzner') {
    const servers = await listHetznerServers(credentials.token as string);
    for (const inst of servers) {
      await upsertInstanceRow({ ...inst, provider: 'hetzner', connectionId: conn.id as string, projectId: null });
    }
  } else if (conn.provider === 'aws') {
    const instances = await listAwsInstances(credentials);
    for (const inst of instances) {
      await upsertInstanceRow({ ...inst, provider: 'aws', connectionId: conn.id as string, projectId: null });
    }
  }

  await db('cloud_connections').where({ id: conn.id }).update({
    status: 'active',
    last_sync_at: new Date(),
    last_error: null,
  });
}

async function upsertInstanceRow(inst: {
  provider: string; resourceType?: string; connectionId: string; projectId: string | null;
  instanceId: string; name: string; status: string; region: string; zone: string;
  privateIp: string | null; publicIp: string | null; machineType: string;
  launchedAt: Date | null; estimatedHourlyCost: number; estimatedMonthlyCost: number;
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

async function syncDns(conn: Record<string, unknown>): Promise<void> {
  // Find dns_connections belonging to same user
  const dnsConns = await db('dns_connections').where({ user_id: conn.user_id }).select('*');

  for (const dnsConn of dnsConns) {
    try {
      const credentials = JSON.parse(decrypt(dnsConn.credentials_enc as string)) as { token: string };

      if (dnsConn.provider === 'cloudflare') {
        const zones = await listCloudflareZones(credentials.token);
        for (const zone of zones) {
          const records = await listCloudflareRecords(credentials.token, zone.id);
          for (const rec of records) {
            await db('dns_records')
              .insert({
                dns_connection_id: dnsConn.id,
                zone: zone.name,
                zone_id: zone.id,
                record_id: rec.id,
                name: rec.name,
                type: rec.type,
                value: rec.content,
                ttl: rec.ttl,
                proxied: rec.proxied,
                last_seen_at: new Date(),
              })
              .onConflict(['dns_connection_id', 'record_id'])
              .merge(['name', 'type', 'value', 'ttl', 'proxied', 'last_seen_at', 'updated_at']);
          }
        }
        await db('dns_connections').where({ id: dnsConn.id }).update({
          status: 'active',
          last_sync_at: new Date(),
          last_error: null,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await db('dns_connections').where({ id: dnsConn.id }).update({
        status: 'error',
        last_error: message,
      });
    }
  }
}
