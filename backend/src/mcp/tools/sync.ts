import db from '../../db';
import { z } from 'zod';
import { syncConnectionInstances } from '../../lib/sync-runner';

export const triggerSyncInput = z.object({
  connection_id: z.string().uuid().describe('Cloud connection UUID to sync'),
});

export async function triggerSync(userId: string, args: z.infer<typeof triggerSyncInput>) {
  const conn = await db('cloud_connections')
    .where({ id: args.connection_id, user_id: userId })
    .first();

  if (!conn) {
    return {
      content: [{ type: 'text' as const, text: `Connection ${args.connection_id} not found` }],
      isError: true,
    };
  }

  if (!['gcp', 'hetzner', 'aws', 'coolify'].includes(conn.provider)) {
    return {
      content: [{ type: 'text' as const, text: `Sync not supported for provider: ${conn.provider}` }],
      isError: true,
    };
  }

  const [run] = await db('sync_runs')
    .insert({ connection_id: args.connection_id, status: 'running' })
    .returning('*');

  runSyncAsync(conn, run.id).catch(() => {});

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        message: `Sync started for connection "${conn.name}" (${conn.provider})`,
        sync_run_id: run.id,
        status: 'running',
      }, null, 2),
    }],
  };
}

async function runSyncAsync(conn: Record<string, string>, runId: string) {
  try {
    await syncConnectionInstances(conn);
    await db('sync_runs').where({ id: runId }).update({ status: 'success', finished_at: new Date() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db('sync_runs').where({ id: runId }).update({ status: 'error', finished_at: new Date(), error_log: message });
  }
}
