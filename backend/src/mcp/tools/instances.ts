import db from '../../db';
import { z } from 'zod';

export const listInstancesInput = z.object({
  provider: z.enum(['gcp', 'aws', 'hetzner', 'coolify']).optional().describe('Filter by cloud provider'),
  status: z.enum(['RUNNING', 'STOPPED', 'TERMINATED', 'ERROR', 'PENDING']).optional().describe('Filter by instance status'),
  resource_type: z.enum(['compute', 'cloudsql', 'app']).optional().describe('Filter by resource type'),
  tags: z.string().optional().describe('Comma-separated tag names to filter by'),
});

export const getInstanceInput = z.object({
  instance_id: z.string().describe('Instance UUID'),
});

function getScopeUserIds(userId: string) {
  return db('users').where({ role: 'admin' }).pluck('id').then((ids: string[]) =>
    ids.length > 0 ? ids : [userId],
  );
}

export async function listInstances(userId: string, args: z.infer<typeof listInstancesInput>) {
  const scopeIds = await getScopeUserIds(userId);

  let query = db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .leftJoin('projects_or_accounts', 'instances.project_or_account_id', 'projects_or_accounts.id')
    .whereIn('cloud_connections.user_id', scopeIds)
    .select(
      'instances.id',
      'instances.provider',
      'instances.resource_type',
      'instances.instance_id',
      'instances.name',
      'instances.status',
      'instances.region',
      'instances.zone',
      'instances.private_ip',
      'instances.public_ip',
      'instances.instance_type',
      'instances.launched_at',
      'instances.estimated_monthly_cost',
      'cloud_connections.name as connection_name',
      'projects_or_accounts.name as project_name',
    )
    .orderBy('instances.name');

  if (args.provider) query = query.where('instances.provider', args.provider);
  if (args.status) query = query.where('instances.status', args.status);
  if (args.resource_type) query = query.where('instances.resource_type', args.resource_type);

  if (args.tags) {
    const tagNames = args.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagNames.length > 0) {
      query = query.whereIn('instances.id', (sub) => {
        sub.select('instance_tags.instance_id')
          .from('instance_tags')
          .join('tags', 'instance_tags.tag_id', 'tags.id')
          .where('tags.user_id', userId)
          .whereIn('tags.name', tagNames);
      });
    }
  }

  const rows = await query;

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
  const instances = rows.map(r => ({
    name: r.name,
    provider: r.provider,
    resource_type: r.resource_type,
    status: r.status,
    region: r.region,
    zone: r.zone,
    public_ip: r.public_ip,
    private_ip: r.private_ip,
    instance_type: r.instance_type,
    connection: r.connection_name,
    project: r.project_name,
    uptime_hours: r.launched_at ? Math.floor((now - new Date(r.launched_at).getTime()) / 3_600_000) : null,
    estimated_monthly_cost: r.estimated_monthly_cost ? parseFloat(r.estimated_monthly_cost) : null,
    domains: r.public_ip ? (ipToDomains.get(r.public_ip) ?? null) : null,
  }));

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(instances, null, 2) }],
  };
}

export async function getInstance(userId: string, args: z.infer<typeof getInstanceInput>) {
  const scopeIds = await getScopeUserIds(userId);

  const inst = await db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .leftJoin('projects_or_accounts', 'instances.project_or_account_id', 'projects_or_accounts.id')
    .where('instances.id', args.instance_id)
    .whereIn('cloud_connections.user_id', scopeIds)
    .select(
      'instances.*',
      'cloud_connections.name as connection_name',
      'projects_or_accounts.name as project_name',
    )
    .first();

  if (!inst) {
    return {
      content: [{ type: 'text' as const, text: `Instance ${args.instance_id} not found` }],
      isError: true,
    };
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
    const payload = typeof inst.raw_payload === 'string' ? JSON.parse(inst.raw_payload) : inst.raw_payload;
    database_version = payload.databaseVersion ?? null;
  }

  let app_urls: string[] = [];
  let git_repository: string | null = null;
  if (inst.resource_type === 'app' && inst.raw_payload) {
    const payload = typeof inst.raw_payload === 'string' ? JSON.parse(inst.raw_payload) : inst.raw_payload;
    app_urls = Array.isArray(payload.fqdn_list) ? payload.fqdn_list : [];
    git_repository = payload.git_repository ?? null;
    if (domains.length === 0) domains = app_urls;
  }

  const result = {
    name: inst.name,
    provider: inst.provider,
    resource_type: inst.resource_type,
    status: inst.status,
    region: inst.region,
    zone: inst.zone,
    public_ip: inst.public_ip,
    private_ip: inst.private_ip,
    instance_type: inst.instance_type,
    connection: inst.connection_name,
    project: inst.project_name,
    launched_at: inst.launched_at,
    estimated_hourly_cost: inst.estimated_hourly_cost ? parseFloat(inst.estimated_hourly_cost) : null,
    estimated_monthly_cost: inst.estimated_monthly_cost ? parseFloat(inst.estimated_monthly_cost) : null,
    domains,
    database_version,
    app_urls,
    git_repository,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}
