/**
 * Shared instance-sync logic — the single implementation used by BOTH the
 * manual sync route and the scheduler. Centralising it here guarantees:
 *   - currency conversion is applied identically on both paths (previously the
 *     manual route stored raw provider currency while the scheduler converted)
 *   - stale instances (deleted in the cloud) are removed after a clean sync
 *     instead of lingering forever (upsert-only had no delete).
 */
import db from '../db';
import { decrypt } from './crypto';
import { listGcpInstances } from '../gcp/sync';
import { refreshBillingCache, loadPriceCache, isCacheStale } from '../gcp/billing';
import { listHetznerServers } from '../hetzner/sync';
import { listAwsInstances } from '../aws/ec2';
import { listCoolifyApps } from '../coolify/sync';
import { listCloudSqlInstances } from '../gcp/cloudsql';
import { getRate, convert } from './exchange-rates';
import { upsertInstanceRow } from './instances';
import { logger } from './logger';

export interface ConnectionSyncResult {
  count: number;
  errors: string[];
}

export async function getPreferredCurrency(): Promise<string> {
  const row = await db('app_settings').where({ key: 'preferred_currency' }).first().catch(() => null);
  return row?.value ?? 'USD';
}

/** Delete rows for this connection (optionally one resource_type) not refreshed since runStart. */
async function cleanupStaleInstances(
  connectionId: string,
  runStart: Date,
  resourceType?: string,
): Promise<number> {
  let q = db('instances')
    .where({ connection_id: connectionId })
    .where('last_seen_at', '<', runStart);
  if (resourceType) q = q.where({ resource_type: resourceType });
  return q.delete();
}

/**
 * Sync all instances for one cloud connection: convert costs to the preferred
 * currency, upsert, and prune instances that vanished from the provider.
 * Throws only on a hard failure (nothing could be listed); partial failures
 * (e.g. one GCP project) are reported via the returned `errors` and skip cleanup
 * for the affected resource type so a transient API blip never deletes live rows.
 */
export async function syncConnectionInstances(
  conn: Record<string, unknown>,
  preferredCurrency?: string,
): Promise<ConnectionSyncResult> {
  const currency = preferredCurrency ?? (await getPreferredCurrency());
  const credentials = JSON.parse(decrypt(conn.credentials_enc as string)) as Record<string, unknown>;
  const connId = conn.id as string;
  const log = logger.child({ module: 'sync', connectionId: connId, provider: conn.provider });
  const runStart = new Date();
  let count = 0;
  const errors: string[] = [];
  log.info('sync started');

  try {
    if (conn.provider === 'gcp') {
      const { priceCache, sourceCurrency } = await loadGcpPricing(credentials);
      const rate = await getRate(sourceCurrency, currency);

      const savedProjects = await db('projects_or_accounts')
        .where({ connection_id: connId })
        .select('id', 'external_id');
      const projects = savedProjects.length
        ? savedProjects.map((p: { id: string; external_id: string }) => ({ id: p.id, externalId: p.external_id }))
        : [{ id: null, externalId: (credentials.project_id as string) || (conn.name as string) }];

      // Compute Engine
      let computeOk = true;
      for (const project of projects) {
        try {
          const instances = await listGcpInstances(project.externalId as string, credentials, priceCache);
          for (const inst of instances) {
            await upsertInstanceRow({
              ...inst,
              estimatedHourlyCost: convert(inst.estimatedHourlyCost, rate),
              estimatedMonthlyCost: convert(inst.estimatedMonthlyCost, rate),
              provider: 'gcp',
              connectionId: connId,
              projectId: project.id as string | null,
            });
            count++;
          }
        } catch (err: unknown) {
          computeOk = false;
          const msg = (err instanceof Error ? err.message : String(err)).split('\n')[0];
          errors.push(`${project.externalId}: ${msg}`);
        }
      }
      // All projects failed and nothing synced → hard failure
      if (!computeOk && count === 0) {
        throw new Error(`All GCP projects failed:\n${errors.join('\n')}`);
      }
      if (computeOk) await cleanupStaleInstances(connId, runStart, 'compute');

      // Cloud SQL (non-fatal — API may simply not be enabled)
      let cloudsqlOk = true;
      for (const project of projects) {
        try {
          const sqlInstances = await listCloudSqlInstances(project.externalId as string, credentials);
          for (const inst of sqlInstances) {
            await upsertInstanceRow({
              ...inst,
              estimatedHourlyCost: convert(inst.estimatedHourlyCost, rate),
              estimatedMonthlyCost: convert(inst.estimatedMonthlyCost, rate),
              provider: 'gcp',
              resourceType: 'cloudsql',
              connectionId: connId,
              projectId: project.id as string | null,
            });
            count++;
          }
        } catch {
          cloudsqlOk = false; // skip cloudsql cleanup so a blip doesn't wipe live rows
        }
      }
      if (cloudsqlOk) await cleanupStaleInstances(connId, runStart, 'cloudsql');
    } else if (conn.provider === 'hetzner') {
      const rate = await getRate('EUR', currency);
      const servers = await listHetznerServers(credentials.token as string);
      for (const inst of servers) {
        await upsertInstanceRow({
          ...inst,
          estimatedHourlyCost: convert(inst.estimatedHourlyCost, rate),
          estimatedMonthlyCost: convert(inst.estimatedMonthlyCost, rate),
          provider: 'hetzner',
          connectionId: connId,
          projectId: null,
        });
        count++;
      }
      await cleanupStaleInstances(connId, runStart);
    } else if (conn.provider === 'aws') {
      const rate = await getRate('USD', currency);
      const instances = await listAwsInstances(credentials);
      for (const inst of instances) {
        await upsertInstanceRow({
          ...inst,
          estimatedHourlyCost: convert(inst.estimatedHourlyCost, rate),
          estimatedMonthlyCost: convert(inst.estimatedMonthlyCost, rate),
          provider: 'aws',
          connectionId: connId,
          projectId: null,
        });
        count++;
      }
      await cleanupStaleInstances(connId, runStart);
    } else if (conn.provider === 'coolify') {
      const apps = await listCoolifyApps(credentials.base_url as string, credentials.api_token as string);
      for (const inst of apps) {
        await upsertInstanceRow({
          ...inst,
          provider: 'coolify',
          resourceType: 'app',
          connectionId: connId,
          projectId: null,
        });
        count++;
      }
      await cleanupStaleInstances(connId, runStart);
    }
  } catch (err: unknown) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await db('cloud_connections').where({ id: connId }).update({ status: 'error', last_error: message });
    log.error({ err: message }, 'sync failed');
    throw err;
  }

  await db('cloud_connections').where({ id: connId }).update({
    status: 'active',
    last_sync_at: new Date(),
    last_error: errors.length ? errors.join('; ').slice(0, 500) : null,
  });

  log.info({ count, errors: errors.length }, 'sync completed');
  return { count, errors };
}

/** Load GCP price cache + detect the catalog currency, persisting it for reuse. */
async function loadGcpPricing(
  credentials: Record<string, unknown>,
): Promise<{ priceCache: Map<string, number> | undefined; sourceCurrency: string }> {
  let priceCache: Map<string, number> | undefined;
  let sourceCurrency = 'USD';
  try {
    if (await isCacheStale(db)) {
      const result = await refreshBillingCache(credentials, db);
      sourceCurrency = result.currency;
      await db('app_settings')
        .insert({ key: 'billing_price_currency', value: sourceCurrency })
        .onConflict('key').merge(['value']);
    } else {
      const row = await db('app_settings').where({ key: 'billing_price_currency' }).first().catch(() => null);
      sourceCurrency = row?.value ?? 'USD';
    }
    priceCache = await loadPriceCache(db);
  } catch { /* non-fatal — fall back to static rate tables, USD */ }
  return { priceCache, sourceCurrency };
}
