import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest, requireAdmin } from '../middleware/auth';

const router = Router();

async function getScopeUserIds(req: AuthRequest): Promise<string[]> {
  if (req.userRole !== 'viewer') return [req.userId!];
  const admins = await db('users').where({ role: 'admin' }).pluck('id');
  return admins.length > 0 ? admins : [req.userId!];
}

/**
 * GET /dns/records
 * List all DNS records across all DNS connections visible to the user.
 * Viewers see admin connections. Supports ?zone=, ?type=, ?connection_id=
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  const { zone, type, connection_id } = req.query;
  const scopeIds = await getScopeUserIds(req);

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
      'dns_records.id',
      'dns_records.dns_connection_id',
      'dns_connections.name as connection_name',
      'dns_connections.provider',
      'dns_records.zone',
      'dns_records.name',
      'dns_records.type',
      'dns_records.value',
      'dns_records.ttl',
      'dns_records.proxied',
      'dns_records.last_seen_at',
      'mi.inst_id as matched_instance_id',
      'mi.inst_name as matched_instance_name',
    )
    .orderBy(['dns_records.zone', 'dns_records.name']);

  if (zone) query = query.where('dns_records.zone', zone as string);
  if (type) query = query.where('dns_records.type', type as string);
  if (connection_id) query = query.where('dns_records.dns_connection_id', connection_id as string);

  const rows = await query;
  res.json(rows);
});

export default router;
