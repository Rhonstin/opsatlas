/**
 * Config export / import.
 *
 * GET  /config/export  — download all connections + policies as JSON
 * POST /config/import  — create any connections/policies not already present
 */
import { Router, Response } from 'express';
import db from '../db';
import { encrypt } from '../lib/crypto';
import { AuthRequest } from '../middleware/auth';

const router = Router();

export interface ConfigExport {
  version: number;
  exported_at: string;
  // Credentials are intentionally absent from exports for security.
  // Re-enter credentials after importing.
  cloud_connections: Array<{
    provider: string;
    name: string;
  }>;
  dns_connections: Array<{
    provider: string;
    name: string;
  }>;
  auto_update_policies: Array<{
    name: string;
    scope: string;
    provider: string | null;
    enabled: boolean;
    interval_minutes: number;
    sync_instances: boolean;
    sync_dns: boolean;
    sync_cost: boolean;
  }>;
}

/** GET /config/export */
router.get('/export', async (req: AuthRequest, res: Response) => {
  const [cloudConns, dnsConns, policies] = await Promise.all([
    db('cloud_connections').where({ user_id: req.userId }),
    db('dns_connections').where({ user_id: req.userId }),
    db('auto_update_policies').where({ user_id: req.userId }),
  ]);

  const payload: ConfigExport = {
    version: 1,
    exported_at: new Date().toISOString(),
    // Credentials are intentionally excluded from the export.
    // Re-enter them after importing to avoid transmitting secrets in backup files.
    cloud_connections: cloudConns.map((c) => ({
      provider: c.provider,
      name: c.name,
    })),
    dns_connections: dnsConns.map((c) => ({
      provider: c.provider,
      name: c.name,
    })),
    auto_update_policies: policies.map((p) => ({
      name: p.name,
      scope: p.scope,
      provider: p.provider,
      enabled: p.enabled,
      interval_minutes: p.interval_minutes,
      sync_instances: p.sync_instances,
      sync_dns: p.sync_dns,
      sync_cost: p.sync_cost,
    })),
  };

  res.json(payload);
});

/** POST /config/import */
router.post('/import', async (req: AuthRequest, res: Response) => {
  const body = req.body as Partial<ConfigExport>;

  if (!body || body.version !== 1) {
    res.status(400).json({ error: 'Invalid config file. Expected version 1.' });
    return;
  }

  const results: Array<{ type: string; name: string; status: 'created' | 'skipped'; reason?: string }> = [];

  // Existing names to detect duplicates
  const [existingCloud, existingDns, existingPolicies] = await Promise.all([
    db('cloud_connections').where({ user_id: req.userId }).select('name', 'provider'),
    db('dns_connections').where({ user_id: req.userId }).select('name', 'provider'),
    db('auto_update_policies').where({ user_id: req.userId }).select('name'),
  ]);

  const cloudKey = (provider: string, name: string) => `${provider}::${name}`;
  const existingCloudSet = new Set(existingCloud.map((c: { provider: string; name: string }) => cloudKey(c.provider, c.name)));
  const existingDnsSet = new Set(existingDns.map((c: { provider: string; name: string }) => cloudKey(c.provider, c.name)));
  const existingPolicySet = new Set(existingPolicies.map((p: { name: string }) => p.name));

  // Import cloud connections (credentials excluded from export — mark as pending, require re-entry)
  for (const conn of body.cloud_connections ?? []) {
    const key = cloudKey(conn.provider, conn.name);
    if (existingCloudSet.has(key)) {
      results.push({ type: 'cloud_connection', name: conn.name, status: 'skipped', reason: 'already exists' });
      continue;
    }
    try {
      await db('cloud_connections').insert({
        user_id: req.userId,
        provider: conn.provider,
        name: conn.name,
        credentials_enc: encrypt(JSON.stringify({})),
        status: 'pending',
      });
      results.push({ type: 'cloud_connection', name: conn.name, status: 'created' });
    } catch (err) {
      results.push({ type: 'cloud_connection', name: conn.name, status: 'skipped', reason: err instanceof Error ? err.message : 'insert failed' });
    }
  }

  // Import DNS connections
  for (const conn of body.dns_connections ?? []) {
    const key = cloudKey(conn.provider, conn.name);
    if (existingDnsSet.has(key)) {
      results.push({ type: 'dns_connection', name: conn.name, status: 'skipped', reason: 'already exists' });
      continue;
    }
    try {
      await db('dns_connections').insert({
        user_id: req.userId,
        provider: conn.provider,
        name: conn.name,
        credentials_enc: encrypt(JSON.stringify({})),
        status: 'pending',
      });
      results.push({ type: 'dns_connection', name: conn.name, status: 'created' });
    } catch (err) {
      results.push({ type: 'dns_connection', name: conn.name, status: 'skipped', reason: err instanceof Error ? err.message : 'insert failed' });
    }
  }

  // Import auto-update policies
  for (const policy of body.auto_update_policies ?? []) {
    if (existingPolicySet.has(policy.name)) {
      results.push({ type: 'auto_update_policy', name: policy.name, status: 'skipped', reason: 'already exists' });
      continue;
    }
    try {
      await db('auto_update_policies').insert({
        user_id: req.userId,
        name: policy.name,
        scope: policy.scope ?? 'global',
        provider: policy.provider ?? null,
        enabled: policy.enabled ?? true,
        interval_minutes: policy.interval_minutes ?? 60,
        sync_instances: policy.sync_instances ?? true,
        sync_dns: policy.sync_dns ?? false,
        sync_cost: policy.sync_cost ?? true,
      });
      results.push({ type: 'auto_update_policy', name: policy.name, status: 'created' });
    } catch (err) {
      results.push({ type: 'auto_update_policy', name: policy.name, status: 'skipped', reason: err instanceof Error ? err.message : 'insert failed' });
    }
  }

  const created = results.filter((r) => r.status === 'created').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  res.json({ created, skipped, results });
});

export default router;
