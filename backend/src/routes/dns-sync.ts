import { Router, Response } from 'express';
import db from '../db';
import { decrypt } from '../lib/crypto';
import { listCloudflareZones, listCloudflareRecords } from '../dns/cloudflare';
import { AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * POST /dns-sync/:connection_id
 * Trigger a DNS sync for a dns_connection. Runs async, returns 202 immediately.
 */
router.post('/:connection_id', async (req: AuthRequest, res: Response) => {
  const conn = await db('dns_connections')
    .where({ id: req.params.connection_id, user_id: req.userId })
    .first();

  if (!conn) {
    res.status(404).json({ error: 'DNS connection not found' });
    return;
  }

  res.status(202).json({ status: 'syncing', connection_id: conn.id });

  runDnsSync(conn).catch(() => {/* already handled inside */});
});

async function runDnsSync(conn: Record<string, string>) {
  try {
    const credentials = JSON.parse(decrypt(conn.credentials_enc)) as { token: string };

    if (conn.provider === 'cloudflare') {
      const zones = await listCloudflareZones(credentials.token);
      let totalRecords = 0;

      for (const zone of zones) {
        const records = await listCloudflareRecords(credentials.token, zone.id);

        for (const rec of records) {
          await db('dns_records')
            .insert({
              dns_connection_id: conn.id,
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
          totalRecords++;
        }
      }

      await db('dns_connections').where({ id: conn.id }).update({
        status: 'active',
        last_sync_at: new Date(),
        last_error: null,
      });

      console.log(`[dns-sync] Cloudflare: synced ${totalRecords} records across ${zones.length} zones`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db('dns_connections').where({ id: conn.id }).update({
      status: 'error',
      last_error: message,
    });
    console.error(`[dns-sync] Error for connection ${conn.id}:`, message);
  }
}

export default router;
