/**
 * GCP Billing Export — actual spend via BigQuery.
 *
 * Prerequisites (user must do this once in GCP Console):
 *   1. Enable billing export → BigQuery export on their billing account.
 *   2. Note the BigQuery dataset reference: "project_id.dataset_name"
 *   3. Add "billing_dataset": "project_id.dataset_name" to their service account JSON.
 *
 * The service account needs BigQuery Data Viewer + BigQuery Job User roles
 * on the billing export project.
 */
import { BigQuery } from '@google-cloud/bigquery';

export interface BillingActualRow {
  project_id: string | null;
  project_name: string | null;
  service: string;
  amount_usd: number;
  currency: string;
}

/**
 * Fetch actual spend for a given month from GCP BigQuery billing export.
 * @param credentials  Parsed service account JSON (may contain `billing_dataset`)
 * @param period       YYYY-MM string, e.g. "2026-04"
 */
export async function fetchGcpBillingActuals(
  credentials: Record<string, unknown>,
  period: string,
): Promise<BillingActualRow[]> {
  const billingDataset = credentials.billing_dataset as string | undefined;
  if (!billingDataset) {
    throw new Error(
      'billing_dataset not set in credentials. ' +
      'Add "billing_dataset": "project_id.dataset_name" to your GCP service account JSON.',
    );
  }

  // period = "2026-04" → invoiceMonth = "202604"
  const invoiceMonth = period.replace('-', '');

  const bq = new BigQuery({ credentials });

  // The billing export table is a wildcard: gcp_billing_export_v1_*
  // We use backtick quoting and the project.dataset prefix.
  const [projectId, datasetName] = billingDataset.split('.');
  if (!projectId || !datasetName) {
    throw new Error('billing_dataset must be in "project_id.dataset_name" format');
  }

  // Location must match the dataset region. Add "billing_location": "EU" to
  // credentials if your billing export dataset is not in the US multi-region.
  const location = (credentials.billing_location as string | undefined) ?? 'US';

  const table = `\`${projectId}.${datasetName}.gcp_billing_export_v1_*\``;

  // Resolve invoice month: if the requested period has no data (e.g. current
  // month hasn't been invoiced yet), fall back to the latest available month.
  let resolvedInvoiceMonth = invoiceMonth;
  const [countRows] = await bq.query({
    query: `SELECT COUNT(*) AS cnt FROM ${table} WHERE invoice.month = @invoiceMonth`,
    params: { invoiceMonth },
    location,
  });
  if ((countRows[0] as Record<string, unknown>)?.cnt === 0 || (countRows[0] as Record<string, unknown>)?.cnt === '0') {
    const [latestRows] = await bq.query({
      query: `SELECT invoice.month AS m FROM ${table} GROUP BY 1 ORDER BY 1 DESC LIMIT 1`,
      location,
    });
    if (latestRows.length > 0) {
      resolvedInvoiceMonth = (latestRows[0] as Record<string, unknown>).m as string;
      console.log(`[billing] No data for ${invoiceMonth}, using latest available: ${resolvedInvoiceMonth}`);
    }
  }

  const query = `
    SELECT
      project.id          AS project_id,
      project.name        AS project_name,
      service.description AS service,
      SUM(cost)           AS amount_usd,
      currency
    FROM ${table}
    WHERE invoice.month = @resolvedInvoiceMonth
      AND cost > 0
    GROUP BY 1, 2, 3, 5
    ORDER BY amount_usd DESC
  `;

  const [rows] = await bq.query({
    query,
    params: { resolvedInvoiceMonth },
    location,
  });

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    project_id: (r.project_id as string | null) ?? null,
    project_name: (r.project_name as string | null) ?? null,
    service: (r.service as string) ?? 'Unknown',
    amount_usd: parseFloat(String(r.amount_usd ?? 0)),
    currency: (r.currency as string) ?? 'USD',
  }));
}
