/**
 * Auto-update scheduler.
 * Ticks every 60 s, finds policies whose next_run_at is overdue, and fires syncs.
 * Reuses runGcpSync / runDnsSync logic from the respective route modules.
 */
import db from './db';
import { runBillingForConnections, currentPeriod } from './lib/billing-refresh';
import { syncConnectionInstances, getPreferredCurrency } from './lib/sync-runner';
import { syncDnsForUser } from './lib/dns-sync';

const TICK_MS = 60_000;

// Max backoff: 24 h
const MAX_BACKOFF_MINUTES = 24 * 60;

// Max policies syncing at the same time
const MAX_CONCURRENT_POLICIES = 3;

// A policy stuck in 'running' longer than this is treated as dead and may be re-claimed
const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

const activeRuns = new Set<Promise<void>>();
let intervalHandle: NodeJS.Timeout | null = null;

export function startScheduler(): { stop: () => Promise<void> } {
  console.log('[scheduler] started — tick every 60 s');

  // Recover from a previous crash: anything still 'running' was interrupted
  recoverInterruptedRuns().catch((err) => {
    console.error('[scheduler] failed to recover interrupted runs:', err);
  });

  intervalHandle = setInterval(tick, TICK_MS);

  return {
    async stop() {
      if (intervalHandle) clearInterval(intervalHandle);
      intervalHandle = null;
      if (activeRuns.size > 0) {
        console.log(`[scheduler] waiting for ${activeRuns.size} active run(s) to finish…`);
        await Promise.allSettled([...activeRuns]);
      }
    },
  };
}

async function recoverInterruptedRuns(): Promise<void> {
  const policies = await db('auto_update_policies')
    .where({ last_status: 'running' })
    .update({ last_status: 'error', last_error: 'interrupted by restart' });

  const runs = await db('auto_update_runs')
    .where({ status: 'running' })
    .update({ status: 'error', error: 'interrupted by restart', finished_at: new Date() });

  if (policies || runs) {
    console.warn(`[scheduler] recovered ${policies} policy(ies) and ${runs} run(s) interrupted by previous shutdown`);
  }
}

async function tick(): Promise<void> {
  try {
    const now = new Date();
    const due = await db('auto_update_policies')
      .where('enabled', true)
      .where('next_run_at', '<=', now)
      .select('*');

    // Simple pool: at most MAX_CONCURRENT_POLICIES policies in flight at once
    const queue = [...due];
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_POLICIES, queue.length) }, async () => {
      let policy;
      while ((policy = queue.shift())) {
        try {
          await runPolicy(policy);
        } catch (err) {
          console.error(`[scheduler] uncaught error for policy ${policy.id}:`, err);
        }
      }
    });
    const batch = Promise.allSettled(workers).then(() => undefined);
    activeRuns.add(batch);
    batch.finally(() => activeRuns.delete(batch));
  } catch (err) {
    console.error('[scheduler] tick error:', err);
  }
}

async function runPolicy(policy: Record<string, unknown>): Promise<void> {
  const startedAt = new Date();

  // Atomic claim: skip if another tick is already running this policy,
  // unless that run looks dead (stuck in 'running' past the stale threshold).
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
  const claimed = await db('auto_update_policies')
    .where({ id: policy.id })
    .where((q) =>
      q.whereNot('last_status', 'running')
        .orWhereNull('last_status')
        .orWhere('last_run_at', '<', staleBefore)
        .orWhereNull('last_run_at'),
    )
    // Stamp last_run_at at claim time so the stale check above measures THIS run's age
    .update({ last_status: 'running', last_run_at: startedAt });

  if (!claimed) return;

  // Insert a run record immediately so it appears in the audit log
  const [run] = await db('auto_update_runs')
    .insert({ policy_id: policy.id, status: 'running', started_at: startedAt })
    .returning('*');

  try {
    const connections = await getTargetConnections(policy);

    let totalInstances = 0;
    let totalDnsRecords = 0;
    let totalCostRows = 0;

    const preferredCurrency = await getPreferredCurrency();

    if (policy.sync_instances) {
      for (const conn of connections) {
        const { count } = await syncConnectionInstances(conn, preferredCurrency);
        totalInstances += count;
      }
    }

    // DNS is user-scoped, not connection-scoped — sync once per run, not once per connection
    if (policy.sync_dns) {
      totalDnsRecords += await syncDnsForUser(policy.user_id as string);
    }

    if (policy.sync_cost) {
      const period = currentPeriod();
      const billingResults = await runBillingForConnections(connections, period);
      const errors = billingResults.filter((r) => r.status === 'error');
      if (errors.length > 0) {
        console.warn(`[scheduler] policy "${policy.name}" billing errors:`, errors.map((r) => `${r.connection_name}: ${r.message}`).join(', '));
      } else {
        const ok = billingResults.filter((r) => r.status === 'ok');
        totalCostRows = ok.reduce((s, r) => s + (r.rows_upserted ?? 0), 0);
        console.log(`[scheduler] policy "${policy.name}" billing: ${totalCostRows} rows upserted for ${period}`);
      }
    }

    const now = new Date();
    await db('auto_update_policies').where({ id: policy.id }).update({
      last_run_at: now,
      next_run_at: nextRunAt(policy.interval_minutes as number, 0),
      last_status: 'success',
      last_error: null,
      failure_count: 0,
    });

    await db('auto_update_runs').where({ id: run.id }).update({
      status: 'success',
      connections_synced: connections.length,
      instances_synced: totalInstances,
      dns_records_synced: totalDnsRecords,
      cost_rows_upserted: totalCostRows,
      finished_at: now,
    });

    console.log(`[scheduler] policy "${policy.name}" completed (${connections.length} connections, ${totalInstances} instances, ${totalDnsRecords} DNS records, ${totalCostRows} cost rows)`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const failures = (policy.failure_count as number) + 1;
    const backoffMinutes = Math.min(
      (policy.interval_minutes as number) * Math.pow(2, failures),
      MAX_BACKOFF_MINUTES,
    );

    const now = new Date();
    await db('auto_update_policies').where({ id: policy.id }).update({
      last_run_at: now,
      next_run_at: nextRunAt(backoffMinutes, 0),
      last_status: 'error',
      last_error: message,
      failure_count: failures,
    });

    await db('auto_update_runs').where({ id: run.id }).update({
      status: 'error',
      error: message,
      finished_at: now,
    });

    console.error(`[scheduler] policy "${policy.name}" failed (backoff ${backoffMinutes} min):`, message);
  }
}

function nextRunAt(intervalMinutes: number, extraMs = 0): Date {
  return new Date(Date.now() + intervalMinutes * 60_000 + extraMs);
}

async function getTargetConnections(policy: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const q = db('cloud_connections');

  if (policy.scope === 'connection' && policy.target_id) {
    q.where({ id: policy.target_id });
  } else if (policy.scope === 'provider' && policy.provider) {
    q.where({ provider: policy.provider });
  }
  // global: no filter — all connections for all users
  // (policy is user-scoped via user_id, so we need to join)
  q.where({ user_id: policy.user_id });

  return q.select('*');
}
