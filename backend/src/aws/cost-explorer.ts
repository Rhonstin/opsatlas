/**
 * AWS Cost Explorer — actual spend via GetCostAndUsage API.
 *
 * The IAM credentials need the `ce:GetCostAndUsage` permission.
 * Cost Explorer is only available in us-east-1.
 */
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GroupDefinitionType,
  Granularity,
} from '@aws-sdk/client-cost-explorer';

export interface BillingActualRow {
  project_id: string | null;  // AWS account ID (linked account)
  project_name: string | null;
  service: string;
  amount_usd: number;
  currency: string;
}

/**
 * Fetch actual AWS spend for a given month via Cost Explorer.
 * @param credentials  { access_key_id, secret_access_key, region? }
 * @param period       YYYY-MM string, e.g. "2026-04"
 */
export async function fetchAwsCostActuals(
  credentials: Record<string, unknown>,
  period: string,
): Promise<BillingActualRow[]> {
  const accessKeyId = credentials.access_key_id as string;
  const secretAccessKey = credentials.secret_access_key as string;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials must include access_key_id and secret_access_key');
  }

  const client = new CostExplorerClient({
    region: 'us-east-1', // Cost Explorer is global, always us-east-1
    credentials: { accessKeyId, secretAccessKey },
  });

  // Build date range for the month
  const [year, month] = period.split('-').map(Number);
  const start = `${period}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${period}-${String(lastDay).padStart(2, '0')}`;

  const response = await client.send(new GetCostAndUsageCommand({
    TimePeriod: { Start: start, End: end },
    Granularity: Granularity.MONTHLY,
    GroupBy: [
      { Type: GroupDefinitionType.DIMENSION, Key: 'SERVICE' },
      { Type: GroupDefinitionType.DIMENSION, Key: 'LINKED_ACCOUNT' },
    ],
    Metrics: ['UnblendedCost'],
  }));

  const rows: BillingActualRow[] = [];

  for (const result of response.ResultsByTime ?? []) {
    for (const group of result.Groups ?? []) {
      const service = group.Keys?.[0] ?? 'Unknown';
      const accountId = group.Keys?.[1] ?? null;
      const amount = parseFloat(group.Metrics?.['UnblendedCost']?.Amount ?? '0');
      const currency = group.Metrics?.['UnblendedCost']?.Unit ?? 'USD';

      if (amount > 0) {
        rows.push({
          project_id: accountId,
          project_name: accountId, // AWS doesn't return account name here
          service,
          amount_usd: amount,
          currency,
        });
      }
    }
  }

  return rows;
}
