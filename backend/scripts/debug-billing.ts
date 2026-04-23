/**
 * Debug script for GCP BigQuery billing export.
 * Runs several diagnostic queries to find where the data is.
 *
 * Usage:
 *   npx ts-node scripts/debug-billing.ts [key-file] [period]
 *   npx ts-node scripts/debug-billing.ts ../../opsatlas-key.json 2026-04
 */
import { BigQuery } from '@google-cloud/bigquery';
import * as fs from 'fs';
import * as path from 'path';

const keyFile = process.argv[2] ?? '../../opsatlas-key.json';
const period  = process.argv[3] ?? new Date().toISOString().slice(0, 7); // YYYY-MM

const credentials = JSON.parse(fs.readFileSync(path.resolve(keyFile), 'utf8'));

const billingDataset  = credentials.billing_dataset as string;
const billingLocation = (credentials.billing_location as string | undefined) ?? 'US';

if (!billingDataset) {
  console.error('ERROR: billing_dataset not found in key file');
  process.exit(1);
}

const [projectId, datasetName] = billingDataset.split('.');
const invoiceMonth = period.replace('-', '');

console.log('=== GCP Billing Debug ===');
console.log(`Key file        : ${keyFile}`);
console.log(`billing_dataset : ${billingDataset}`);
console.log(`billing_location: ${billingLocation}`);
console.log(`Period          : ${period}  →  invoice.month = "${invoiceMonth}"`);
console.log(`Table pattern   : ${projectId}.${datasetName}.gcp_billing_export_v1_*`);
console.log('');

const bq = new BigQuery({ credentials });

async function run(label: string, query: string, params?: Record<string, unknown>) {
  console.log(`--- ${label} ---`);
  console.log(query.trim());
  console.log('');
  try {
    const [rows] = await bq.query({ query, params, location: billingLocation });
    if (rows.length === 0) {
      console.log('(no rows)\n');
    } else {
      console.table(rows);
      console.log('');
    }
    return rows;
  } catch (err: unknown) {
    console.error('ERROR:', err instanceof Error ? err.message : err);
    console.log('');
    return [];
  }
}

(async () => {
  // 1. Total row count in the table
  await run(
    '1. Total rows in billing table',
    `SELECT COUNT(*) AS total_rows
     FROM \`${projectId}.${datasetName}.gcp_billing_export_v1_*\``,
  );

  // 2. Available invoice months
  await run(
    '2. Available invoice.month values',
    `SELECT invoice.month AS invoice_month, COUNT(*) AS row_count
     FROM \`${projectId}.${datasetName}.gcp_billing_export_v1_*\`
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT 10`,
  );

  // 3. Usage date range
  await run(
    '3. Usage date range in the table',
    `SELECT
       MIN(usage_start_time) AS earliest,
       MAX(usage_end_time)   AS latest,
       COUNT(*)              AS total_rows
     FROM \`${projectId}.${datasetName}.gcp_billing_export_v1_*\``,
  );

  // 4. Target month — all rows (including cost = 0)
  await run(
    `4. Rows for invoice.month = "${invoiceMonth}" (any cost)`,
    `SELECT COUNT(*) AS row_count, SUM(cost) AS total_cost
     FROM \`${projectId}.${datasetName}.gcp_billing_export_v1_*\`
     WHERE invoice.month = @invoiceMonth`,
    { invoiceMonth },
  );

  // 5. Top services for the LATEST available month (cost > 0)
  const latestRows = await run(
    '5. Latest available invoice month',
    `SELECT invoice.month AS m FROM \`${projectId}.${datasetName}.gcp_billing_export_v1_*\`
     GROUP BY 1 ORDER BY 1 DESC LIMIT 1`,
  );
  const latestMonth = latestRows.length > 0 ? (latestRows[0] as Record<string,unknown>).m as string : invoiceMonth;
  console.log(`→ Will use invoice.month = "${latestMonth}" for service breakdown\n`);

  await run(
    `6. Top services for invoice.month = "${latestMonth}" (cost > 0)`,
    `SELECT
       service.description AS service,
       SUM(cost)           AS total_cost,
       currency
     FROM \`${projectId}.${datasetName}.gcp_billing_export_v1_*\`
     WHERE invoice.month = @latestMonth
       AND cost > 0
     GROUP BY 1, 3
     ORDER BY total_cost DESC
     LIMIT 10`,
    { latestMonth },
  );
})();
