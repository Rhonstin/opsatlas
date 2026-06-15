import db from '../../db';
import { z } from 'zod';

export const listDnsRecordsInput = z.object({
  zone: z.string().optional().describe('Filter by DNS zone name'),
  type: z.enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'SRV']).optional().describe('Filter by record type'),
  connection_id: z.string().uuid().optional().describe('Filter by DNS connection UUID'),
});

function getScopeUserIds(userId: string) {
  return db('users').where({ role: 'admin' }).pluck('id').then((ids: string[]) =>
    ids.length > 0 ? ids : [userId],
  );
}

export async function listDnsRecords(userId: string, args: z.infer<typeof listDnsRecordsInput>) {
  const scopeIds = await getScopeUserIds(userId);

  const userInstances = db('instances')
    .join('cloud_connections as cc_inst', 'instances.connection_id', 'cc_inst.id')
    .whereIn('cc_inst.user_id', scopeIds)
    .whereNotNull('instances.public_ip')
    .select(
      'instances.id as inst_id',
      'instances.name as inst_name',
      'instances.public_ip as inst_public_ip',
    )
    .as('mi');

  let query = db('dns_records')
    .join('dns_connections', 'dns_records.dns_connection_id', 'dns_connections.id')
    .whereIn('dns_connections.user_id', scopeIds)
    .leftJoin(userInstances, 'dns_records.value', 'mi.inst_public_ip')
    .select(
      'dns_records.zone',
      'dns_records.name',
      'dns_records.type',
      'dns_records.value',
      'dns_records.ttl',
      'dns_records.proxied',
      'dns_records.last_seen_at',
      'dns_connections.name as connection_name',
      'dns_connections.provider as dns_provider',
      'mi.inst_name as matched_instance',
    )
    .orderBy(['dns_records.zone', 'dns_records.name']);

  if (args.zone) query = query.where('dns_records.zone', args.zone);
  if (args.type) query = query.where('dns_records.type', args.type);
  if (args.connection_id) query = query.where('dns_records.dns_connection_id', args.connection_id);

  const rows = await query;

  const records = rows.map(r => ({
    zone: r.zone,
    name: r.name,
    type: r.type,
    value: r.value,
    ttl: r.ttl,
    proxied: r.proxied,
    connection: r.connection_name,
    dns_provider: r.dns_provider,
    matched_instance: r.matched_instance,
    last_seen_at: r.last_seen_at,
  }));

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(records, null, 2) }],
  };
}
