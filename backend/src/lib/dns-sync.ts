/**
 * Shared DNS sync — single implementation for the manual route and the scheduler.
 * Upserts records and prunes ones deleted at the provider (stale cleanup).
 */
import db from '../db';
import { decrypt } from './crypto';
import { listCloudflareZones, listCloudflareRecords } from '../dns/cloudflare';
import { logger } from './logger';

/** Sync one DNS connection. Returns the number of records seen. Throws on failure. */
export async function syncDnsConnection(conn: Record<string, unknown>): Promise<number> {
  const connId = conn.id as string;
  const log = logger.child({ module: 'dns-sync', connectionId: connId, provider: conn.provider });
  const runStart = new Date();
  let count = 0;

  try {
    const credentials = JSON.parse(decrypt(conn.credentials_enc as string)) as { token: string };

    if (conn.provider === 'cloudflare') {
      const zones = await listCloudflareZones(credentials.token);
      for (const zone of zones) {
        const records = await listCloudflareRecords(credentials.token, zone.id);
        for (const rec of records) {
          await db('dns_records')
            .insert({
              dns_connection_id: connId,
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
          count++;
        }
      }

      // Prune records deleted at Cloudflare since this run started
      await db('dns_records')
        .where({ dns_connection_id: connId })
        .where('last_seen_at', '<', runStart)
        .delete();

      await db('dns_connections').where({ id: connId }).update({
        status: 'active',
        last_sync_at: new Date(),
        last_error: null,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db('dns_connections').where({ id: connId }).update({ status: 'error', last_error: message });
    log.error({ err: message }, 'dns sync failed');
    throw err;
  }

  log.info({ count }, 'dns sync completed');
  return count;
}

/** Sync every DNS connection owned by a user. Errors on individual connections are isolated. */
export async function syncDnsForUser(userId: string): Promise<number> {
  const dnsConns = await db('dns_connections').where({ user_id: userId }).select('*');
  let total = 0;
  for (const dnsConn of dnsConns) {
    try {
      total += await syncDnsConnection(dnsConn);
    } catch {
      /* status already recorded on the connection row */
    }
  }
  return total;
}
