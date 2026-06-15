import db from '../../db';
import { z } from 'zod';

export const getConnectionHealthInput = z.object({
  connection_id: z.string().uuid().describe('Connection UUID'),
});

export async function listConnections(userId: string) {
  const connections = await db('cloud_connections')
    .where({ user_id: userId })
    .select('id', 'provider', 'name', 'status', 'last_sync_at', 'last_error', 'created_at');

  const dnsConnections = await db('dns_connections')
    .where({ user_id: userId })
    .select('id', 'provider', 'name', 'status', 'last_sync_at', 'last_error', 'created_at');

  const result = {
    cloud_connections: connections.map(c => ({
      id: c.id,
      provider: c.provider,
      name: c.name,
      status: c.status,
      last_sync_at: c.last_sync_at,
      last_error: c.last_error,
    })),
    dns_connections: dnsConnections.map(c => ({
      id: c.id,
      provider: c.provider,
      name: c.name,
      status: c.status,
      last_sync_at: c.last_sync_at,
      last_error: c.last_error,
    })),
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}

export async function getConnectionHealth(userId: string, args: z.infer<typeof getConnectionHealthInput>) {
  const conn = await db('cloud_connections')
    .where({ id: args.connection_id, user_id: userId })
    .select('id', 'provider', 'name', 'status', 'last_sync_at', 'last_error', 'created_at')
    .first();

  if (!conn) {
    return {
      content: [{ type: 'text' as const, text: `Connection ${args.connection_id} not found` }],
      isError: true,
    };
  }

  const projects = await db('projects_or_accounts')
    .where({ connection_id: args.connection_id })
    .select('id', 'external_id', 'name', 'last_sync_at', 'last_error');

  const recentRuns = await db('sync_runs')
    .where({ connection_id: args.connection_id })
    .select('id', 'status', 'started_at', 'finished_at', 'error_log')
    .orderBy('started_at', 'desc')
    .limit(5);

  const instanceCount = await db('instances')
    .where({ connection_id: args.connection_id })
    .count('* as count')
    .first();

  const result = {
    connection: conn,
    projects,
    recent_sync_runs: recentRuns,
    instance_count: parseInt(String(instanceCount?.count ?? 0)),
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}
