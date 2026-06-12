import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';
import { parseMachineType } from '../gcp/cost';

const router = Router();

/** Viewers see all admin users' instances; admins see their own. */
async function getScopeUserIds(req: AuthRequest): Promise<string[]> {
  if (req.userRole !== 'viewer') return [req.userId!];
  const admins = await db('users').where({ role: 'admin' }).pluck('id');
  return admins.length > 0 ? admins : [req.userId!];
}

/**
 * GET /instances
 * List all instances for the authenticated user across all connections.
 * Supports ?provider=gcp|aws, ?status=RUNNING|STOPPED, ?connection_id=uuid
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  const { provider, status, connection_id, resource_type } = req.query;
  const scopeIds = await getScopeUserIds(req);

  let query = db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .leftJoin('projects_or_accounts', 'instances.project_or_account_id', 'projects_or_accounts.id')
    .whereIn('cloud_connections.user_id', scopeIds)
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
      'projects_or_accounts.name as project_name',
      'projects_or_accounts.external_id as project_external_id',
    )
    .orderBy('instances.name');

  if (provider) query = query.where('instances.provider', provider as string);
  if (status) query = query.where('instances.status', status as string);
  if (connection_id) query = query.where('instances.connection_id', connection_id as string);
  if (resource_type) query = query.where('instances.resource_type', resource_type as string);

  const rows = await query;

  const now = Date.now();
  let withUptime = rows.map((r) => ({
    ...r,
    uptime_hours: r.launched_at
      ? Math.floor((now - new Date(r.launched_at).getTime()) / 3_600_000)
      : null,
    domains: null as string[] | null,
  }));

  // Enrich with domain names
  if (req.query.with_dns === 'true') {
    const dnsRows = await db('dns_records')
      .join('dns_connections', 'dns_records.dns_connection_id', 'dns_connections.id')
      .whereIn('dns_connections.user_id', scopeIds)
      .whereIn('dns_records.type', ['A', 'AAAA'])
      .select('dns_records.value as ip', 'dns_records.name as domain', 'dns_records.proxied');

    const ipToDomains = new Map<string, string[]>();
    for (const r of dnsRows) {
      if (!ipToDomains.has(r.ip)) ipToDomains.set(r.ip, []);
      const label = r.proxied ? `${r.domain} (proxied)` : r.domain;
      ipToDomains.get(r.ip)!.push(label);
    }

    const appIds = withUptime.filter((i) => i.resource_type === 'app').map((i) => i.id);
    const appFqdnMap = new Map<string, string[]>();
    if (appIds.length > 0) {
      const payloadRows = await db('instances')
        .whereIn('id', appIds)
        .select('id', 'raw_payload');
      for (const row of payloadRows) {
        const payload = typeof row.raw_payload === 'string'
          ? JSON.parse(row.raw_payload as string)
          : (row.raw_payload as Record<string, unknown>);
        const fqdns = Array.isArray(payload?.fqdn_list) ? (payload.fqdn_list as string[]) : [];
        if (fqdns.length > 0) appFqdnMap.set(row.id as string, fqdns);
      }
    }

    withUptime = withUptime.map((inst) => {
      if (inst.resource_type === 'app') {
        return { ...inst, domains: appFqdnMap.get(inst.id) ?? null };
      }
      return { ...inst, domains: inst.public_ip ? (ipToDomains.get(inst.public_ip) ?? null) : null };
    });
  }

  res.json(withUptime);
});

/**
 * GET /instances/export
 * Download all instances as a JSON file. Same visibility rules as GET /instances;
 * viewers get no cost fields. Supports ?provider=, ?status=, ?resource_type=.
 * Must be declared before /:id to avoid routing conflict.
 */
router.get('/export', async (req: AuthRequest, res: Response) => {
  const { provider, status, resource_type } = req.query;
  const scopeIds = await getScopeUserIds(req);
  const isViewer = req.userRole === 'viewer';

  let query = db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .leftJoin('projects_or_accounts', 'instances.project_or_account_id', 'projects_or_accounts.id')
    .whereIn('cloud_connections.user_id', scopeIds)
    .select(
      'instances.provider',
      'instances.resource_type',
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
      'projects_or_accounts.name as project_name',
      'projects_or_accounts.external_id as project_external_id',
    )
    .orderBy(['instances.provider', 'instances.name']);

  if (provider) query = query.where('instances.provider', provider as string);
  if (status) query = query.where('instances.status', status as string);
  if (resource_type) query = query.where('instances.resource_type', resource_type as string);

  const rows = await query;

  // Map public IPs to domain names, same as the list view
  const dnsRows = await db('dns_records')
    .join('dns_connections', 'dns_records.dns_connection_id', 'dns_connections.id')
    .whereIn('dns_connections.user_id', scopeIds)
    .whereIn('dns_records.type', ['A', 'AAAA'])
    .select('dns_records.value as ip', 'dns_records.name as domain');
  const ipToDomains = new Map<string, string[]>();
  for (const r of dnsRows) {
    if (!ipToDomains.has(r.ip)) ipToDomains.set(r.ip, []);
    ipToDomains.get(r.ip)!.push(r.domain);
  }

  const now = Date.now();
  const instances = rows.map((r) => {
    const { estimated_hourly_cost, estimated_monthly_cost, ...rest } = r;
    return {
      ...rest,
      uptime_hours: r.launched_at
        ? Math.floor((now - new Date(r.launched_at).getTime()) / 3_600_000)
        : null,
      domains: r.public_ip ? (ipToDomains.get(r.public_ip) ?? null) : null,
      ...(isViewer ? {} : { estimated_hourly_cost, estimated_monthly_cost }),
    };
  });

  const filename = `opsatlas-instances-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json({
    exported_at: new Date().toISOString(),
    count: instances.length,
    instances,
  });
});

/**
 * GET /instances/cost-summary
 * Aggregated cost data: by connection, top expensive, long-running, idle candidates.
 * Must be declared before /:id to avoid routing conflict.
 */
router.get('/cost-summary', async (req: AuthRequest, res: Response) => {
  const LONG_RUNNING_HOURS = 30 * 24;
  const scopeIds = await getScopeUserIds(req);

  const rows = await db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .leftJoin('projects_or_accounts', 'instances.project_or_account_id', 'projects_or_accounts.id')
    .whereIn('cloud_connections.user_id', scopeIds)
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

  const mappedResult = await db('dns_records')
    .join('dns_connections', 'dns_records.dns_connection_id', 'dns_connections.id')
    .join('instances as inst_m', 'dns_records.value', 'inst_m.public_ip')
    .join('cloud_connections as cc_m', 'inst_m.connection_id', 'cc_m.id')
    .whereIn('dns_connections.user_id', scopeIds)
    .whereIn('cc_m.user_id', scopeIds)
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
  const scopeIds = await getScopeUserIds(req);

  const inst = await db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .leftJoin('projects_or_accounts', 'instances.project_or_account_id', 'projects_or_accounts.id')
    .where('instances.id', req.params.id)
    .whereIn('cloud_connections.user_id', scopeIds)
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

  const [cpu_count, ram_gb] = inst.instance_type
    ? parseMachineType(inst.instance_type)
    : [null, null];

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

  let domains: string[] = [];
  if (inst.public_ip) {
    const dnsRows = await db('dns_records')
      .join('dns_connections', 'dns_records.dns_connection_id', 'dns_connections.id')
      .whereIn('dns_connections.user_id', scopeIds)
      .where('dns_records.value', inst.public_ip)
      .whereIn('dns_records.type', ['A', 'AAAA'])
      .select('dns_records.name', 'dns_records.proxied');
    domains = dnsRows.map((r: { name: string; proxied: boolean }) =>
      r.proxied ? `${r.name} (proxied)` : r.name,
    );
  }

  let database_version: string | null = null;
  if (inst.resource_type === 'cloudsql' && inst.raw_payload) {
    const payload =
      typeof inst.raw_payload === 'string'
        ? JSON.parse(inst.raw_payload as string)
        : inst.raw_payload;
    database_version = (payload as Record<string, unknown>).databaseVersion as string ?? null;
  }

  let app_urls: string[] = [];
  let git_repository: string | null = null;
  let git_branch: string | null = null;
  if (inst.resource_type === 'app' && inst.raw_payload) {
    const payload = typeof inst.raw_payload === 'string'
      ? JSON.parse(inst.raw_payload as string)
      : inst.raw_payload as Record<string, unknown>;
    const fqdnList = Array.isArray(payload.fqdn_list) ? (payload.fqdn_list as string[]) : [];
    app_urls = fqdnList;
    if (domains.length === 0) domains = fqdnList;
    git_repository = (payload.git_repository as string | null) ?? null;
    git_branch = (payload.git_branch as string | null) ?? null;
  }

  const { raw_payload: _raw, ...rest } = inst;
  res.json({ ...rest, cpu_count, ram_gb, disks, domains, database_version, app_urls, git_repository, git_branch });
});

export default router;
