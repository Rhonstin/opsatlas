import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';
import { parseMachineType } from '../gcp/cost';

const router = Router();

/**
 * GET /instances
 * List all instances for the authenticated user across all connections.
 * Supports ?provider=gcp|aws, ?status=RUNNING|STOPPED, ?connection_id=uuid
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  const { provider, status, connection_id, resource_type } = req.query;

  let query = db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .leftJoin('favorite_instances', function () {
      this.on('favorite_instances.instance_id', 'instances.id')
        .andOn('favorite_instances.user_id', db.raw('?', [req.userId as string]));
    })
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
      'instances.private_ip',
      'instances.public_ip',
      'instances.instance_type',
      'instances.launched_at',
      'instances.last_seen_at',
      'instances.estimated_hourly_cost',
      'instances.estimated_monthly_cost',
      'instances.project_or_account_id',
      'instances.created_at',
      db.raw('(favorite_instances.id IS NOT NULL) as is_favorited'),
    )
    .orderBy('instances.name');

  const VALID_PROVIDERS = ['gcp', 'aws', 'hetzner'];
  const VALID_STATUSES = ['RUNNING', 'STOPPED', 'TERMINATED', 'STAGING', 'PROVISIONING', 'REPAIRING', 'SUSPENDED'];
  const VALID_RESOURCE_TYPES = ['compute', 'cloudsql'];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (provider) {
    if (!VALID_PROVIDERS.includes(provider as string)) {
      res.status(400).json({ error: 'Invalid provider' });
      return;
    }
    query = query.where('instances.provider', provider as string);
  }
  if (status) {
    if (!VALID_STATUSES.includes(status as string)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    query = query.where('instances.status', status as string);
  }
  if (connection_id) {
    if (!UUID_RE.test(connection_id as string)) {
      res.status(400).json({ error: 'Invalid connection_id' });
      return;
    }
    query = query.where('instances.connection_id', connection_id as string);
  }
  if (resource_type) {
    if (!VALID_RESOURCE_TYPES.includes(resource_type as string)) {
      res.status(400).json({ error: 'Invalid resource_type' });
      return;
    }
    query = query.where('instances.resource_type', resource_type as string);
  }

  const rows = await query;

  // Compute uptime hours client-side to avoid DB dialect issues
  const now = Date.now();
  let withUptime = rows.map((r) => ({
    ...r,
    uptime_hours: r.launched_at
      ? Math.floor((now - new Date(r.launched_at).getTime()) / 3_600_000)
      : null,
    domains: null as string[] | null,
  }));

  // Optionally enrich with DNS domain names
  if (req.query.with_dns === 'true') {
    // Fetch all A/AAAA records belonging to the same user
    const dnsRows = await db('dns_records')
      .join('dns_connections', 'dns_records.dns_connection_id', 'dns_connections.id')
      .where('dns_connections.user_id', req.userId)
      .whereIn('dns_records.type', ['A', 'AAAA'])
      .select('dns_records.value as ip', 'dns_records.name as domain', 'dns_records.proxied');

    // Build IP → domain list map
    const ipToDomains = new Map<string, string[]>();
    for (const r of dnsRows) {
      if (!ipToDomains.has(r.ip)) ipToDomains.set(r.ip, []);
      const label = r.proxied ? `${r.domain} (proxied)` : r.domain;
      ipToDomains.get(r.ip)!.push(label);
    }

    withUptime = withUptime.map((inst) => ({
      ...inst,
      domains: inst.public_ip ? (ipToDomains.get(inst.public_ip) ?? null) : null,
    }));
  }

  res.json(withUptime);
});

/**
 * GET /instances/cost-summary
 * Aggregated cost data: by connection, top expensive, long-running, idle candidates.
 * Must be declared before /:id to avoid routing conflict.
 */
router.get('/cost-summary', async (req: AuthRequest, res: Response) => {
  const LONG_RUNNING_HOURS = 30 * 24; // 30 days

  const rows = await db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .leftJoin('projects_or_accounts', 'instances.project_or_account_id', 'projects_or_accounts.id')
    .where('cloud_connections.user_id', req.userId)
    .select(
      'instances.id',
      'instances.name',
      'instances.provider',
      'instances.status',
      'instances.instance_type',
      'instances.region',
      'instances.launched_at',
      'instances.estimated_hourly_cost',
      'instances.estimated_monthly_cost',
      'instances.connection_id',
      'instances.project_or_account_id',
      'cloud_connections.name as connection_name',
      'projects_or_accounts.name as project_name',
      'projects_or_accounts.external_id as project_external_id',
    );

  const now = Date.now();
  const instances = rows.map((r) => ({
    ...r,
    uptime_hours: r.launched_at
      ? Math.floor((now - new Date(r.launched_at).getTime()) / 3_600_000)
      : null,
    monthly_cost: r.estimated_monthly_cost ? parseFloat(r.estimated_monthly_cost) : 0,
  }));

  // Cost aggregated per project (fall back to connection if no project stored)
  const byProjectMap = new Map<string, {
    key: string;
    project_name: string;
    project_external_id: string | null;
    connection_name: string;
    provider: string;
    total_monthly: number;
    instance_count: number;
  }>();
  for (const inst of instances) {
    const key = inst.project_or_account_id ?? inst.connection_id;
    if (!byProjectMap.has(key)) {
      byProjectMap.set(key, {
        key,
        project_name: inst.project_name ?? inst.connection_name,
        project_external_id: inst.project_external_id ?? null,
        connection_name: inst.connection_name,
        provider: inst.provider,
        total_monthly: 0,
        instance_count: 0,
      });
    }
    const entry = byProjectMap.get(key)!;
    entry.total_monthly += inst.monthly_cost;
    entry.instance_count += 1;
  }

  const topExpensive = [...instances]
    .filter((i) => i.monthly_cost > 0)
    .sort((a, b) => b.monthly_cost - a.monthly_cost)
    .slice(0, 5);

  const longRunning = instances.filter(
    (i) => i.status === 'RUNNING' && i.uptime_hours !== null && i.uptime_hours > LONG_RUNNING_HOURS,
  );

  const idleCandidates = instances.filter(
    (i) => i.status === 'STOPPED' || i.status === 'TERMINATED',
  );

  // Count DNS records whose IP matches one of the user's instances
  const mappedResult = await db('dns_records')
    .join('dns_connections', 'dns_records.dns_connection_id', 'dns_connections.id')
    .join('instances as inst_m', 'dns_records.value', 'inst_m.public_ip')
    .join('cloud_connections as cc_m', 'inst_m.connection_id', 'cc_m.id')
    .where('dns_connections.user_id', req.userId)
    .where('cc_m.user_id', req.userId)
    .countDistinct('dns_records.id as count')
    .first();
  const domains_mapped = parseInt(String(mappedResult?.count ?? 0));

  res.json({
    by_project: Array.from(byProjectMap.values()).sort((a, b) => b.total_monthly - a.total_monthly),
    top_expensive: topExpensive,
    long_running: longRunning,
    idle_candidates: idleCandidates,
    domains_mapped,
  });
});

/**
 * GET /instances/:id
 * Single instance detail.
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const inst = await db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .leftJoin('projects_or_accounts', 'instances.project_or_account_id', 'projects_or_accounts.id')
    .where('instances.id', req.params.id)
    .where('cloud_connections.user_id', req.userId)
    .select(
      'instances.*',
      'cloud_connections.name as connection_name',
      'projects_or_accounts.name as project_name',
      'projects_or_accounts.external_id as project_external_id',
    )
    .first();

  if (!inst) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Derive CPU / RAM from machine type
  const [cpu_count, ram_gb] = inst.instance_type
    ? parseMachineType(inst.instance_type)
    : [null, null];

  // Parse attached disks from raw_payload
  interface RawDisk {
    deviceName?: unknown; diskSizeGb?: unknown; type?: unknown;
    boot?: unknown; interface?: unknown;
  }
  let disks: Array<{ device_name: string; size_gb: number; type: string; boot: boolean; iface: string }> = [];
  if (inst.raw_payload) {
    const payload: Record<string, unknown> =
      typeof inst.raw_payload === 'string'
        ? JSON.parse(inst.raw_payload as string)
        : (inst.raw_payload as Record<string, unknown>);
    const rawDisks: RawDisk[] = Array.isArray(payload.disks) ? (payload.disks as RawDisk[]) : [];
    disks = rawDisks.map((d) => ({
      device_name: String(d.deviceName ?? ''),
      size_gb: parseInt(String(d.diskSizeGb ?? '0'), 10),
      type: String(d.type ?? 'PERSISTENT'),
      boot: Boolean(d.boot),
      iface: String(d.interface ?? 'SCSI'),
    }));
  }

  // DNS domains pointing at this instance's public IP
  let domains: string[] = [];
  if (inst.public_ip) {
    const dnsRows = await db('dns_records')
      .join('dns_connections', 'dns_records.dns_connection_id', 'dns_connections.id')
      .where('dns_connections.user_id', req.userId)
      .where('dns_records.value', inst.public_ip)
      .whereIn('dns_records.type', ['A', 'AAAA'])
      .select('dns_records.name', 'dns_records.proxied');
    domains = dnsRows.map((r: { name: string; proxied: boolean }) =>
      r.proxied ? `${r.name} (proxied)` : r.name,
    );
  }

  // Extract Cloud SQL database version if present
  let database_version: string | null = null;
  if (inst.resource_type === 'cloudsql' && inst.raw_payload) {
    const payload =
      typeof inst.raw_payload === 'string'
        ? JSON.parse(inst.raw_payload as string)
        : inst.raw_payload;
    database_version = (payload as Record<string, unknown>).databaseVersion as string ?? null;
  }

  const { raw_payload: _raw, ...rest } = inst;
  res.json({ ...rest, cpu_count, ram_gb, disks, domains, database_version });
});

export default router;
