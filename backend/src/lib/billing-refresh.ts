/**
 * Shared billing refresh logic used by both the HTTP route and the scheduler.
 */
import db from '../db';
import { decrypt } from './crypto';
import { fetchGcpBillingActuals } from '../gcp/billing-actuals';
import { fetchAwsCostActuals } from '../aws/cost-explorer';
import { fetchHetznerBillingActuals } from '../hetzner/billing';

export interface BillingRefreshRowResult {
  connection_id: string;
  connection_name: string;
  provider: string;
  status: 'ok' | 'skipped' | 'error';
  rows_upserted?: number;
  message?: string;
}

export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Fetch and upsert billing actuals for all eligible connections owned by userId.
 * Returns per-connection results.
 */
export async function refreshBillingForUser(
  userId: string,
  period: string,
): Promise<BillingRefreshRowResult[]> {
  const connections = await db('cloud_connections')
    .where({ user_id: userId })
    .whereIn('provider', ['gcp', 'aws', 'hetzner'])
    .select('*');

  return runBillingForConnections(connections, period);
}

/**
 * Fetch and upsert billing actuals for a specific list of connections.
 * Connections need not share the same user — used by the scheduler.
 */
export async function runBillingForConnections(
  connections: Array<Record<string, unknown>>,
  period: string,
): Promise<BillingRefreshRowResult[]> {
  const results: BillingRefreshRowResult[] = [];

  for (const conn of connections) {
    if (!['gcp', 'aws', 'hetzner'].includes(conn.provider as string)) continue;

    const credentials = JSON.parse(decrypt(conn.credentials_enc as string)) as Record<string, unknown>;

    try {
      let rows: Array<{
        project_id: string | null;
        project_name: string | null;
        service: string;
        amount_usd: number;
        currency: string;
      }> = [];

      if (conn.provider === 'gcp') {
        if (!credentials.billing_dataset) {
          results.push({
            connection_id: conn.id as string,
            connection_name: conn.name as string,
            provider: 'gcp',
            status: 'skipped',
            message: 'billing_dataset not configured',
          });
          continue;
        }
        rows = await fetchGcpBillingActuals(credentials, period);
      } else if (conn.provider === 'aws') {
        rows = await fetchAwsCostActuals(credentials, period);
      } else if (conn.provider === 'hetzner') {
        rows = await fetchHetznerBillingActuals(credentials.token as string, period);
      }

      for (const row of rows) {
        await db('billing_actuals')
          .insert({
            connection_id: conn.id,
            provider: conn.provider,
            period,
            project_id: row.project_id,
            project_name: row.project_name,
            service: row.service,
            amount_usd: row.amount_usd,
            currency: row.currency,
            fetched_at: new Date(),
          })
          .onConflict(['connection_id', 'period', 'project_id', 'service'])
          .merge(['amount_usd', 'currency', 'project_name', 'fetched_at']);
      }

      results.push({
        connection_id: conn.id as string,
        connection_name: conn.name as string,
        provider: conn.provider as string,
        status: 'ok',
        rows_upserted: rows.length,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        connection_id: conn.id as string,
        connection_name: conn.name as string,
        provider: conn.provider as string,
        status: 'error',
        message,
      });
    }
  }

  return results;
}
