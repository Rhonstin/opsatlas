/**
 * GCP Cloud SQL sync.
 * Calls the Cloud SQL Admin REST API v1 to list instances in a project.
 * Auth reuses the same service account credentials as Compute Engine sync.
 */
import { GoogleAuth } from 'google-auth-library';

export interface CloudSqlInstance {
  instanceId: string;
  name: string;
  status: string;
  region: string;
  zone: string;
  machineType: string;          // tier, e.g. "db-n1-standard-2"
  databaseVersion: string;      // e.g. "POSTGRES_14", "MYSQL_8_0"
  privateIp: string | null;
  publicIp: string | null;
  launchedAt: Date | null;
  estimatedHourlyCost: number;
  estimatedMonthlyCost: number;
  rawPayload: Record<string, unknown>;
}

// Static monthly cost estimates (USD) for common Cloud SQL tiers.
// Source: GCP pricing page (us-central1, single zone, no HA).
const TIER_MONTHLY: Record<string, number> = {
  'db-f1-micro':        7.67,
  'db-g1-small':       25.56,
  'db-n1-standard-1':  49.61,
  'db-n1-standard-2':  99.22,
  'db-n1-standard-4': 198.44,
  'db-n1-standard-8': 396.88,
  'db-n1-highmem-2':  138.45,
  'db-n1-highmem-4':  276.90,
  'db-n1-highmem-8':  553.80,
  // Shared-core (2nd gen)
  'db-perf-optimized-N-2':   60.00,
  'db-perf-optimized-N-4':  120.00,
  'db-perf-optimized-N-8':  240.00,
  'db-perf-optimized-N-16': 480.00,
};

/**
 * Estimate monthly cost for a Cloud SQL tier.
 * For `db-custom-{cpus}-{ramMb}` tiers, falls back to:
 *   vCPU × $0.0413/hr + RAM_GB × $0.007/hr   (both × 730 hrs/mo)
 */
function estimateCloudSqlCost(tier: string): { hourly: number; monthly: number } {
  const known = TIER_MONTHLY[tier];
  if (known !== undefined) {
    return { hourly: known / 730, monthly: known };
  }

  // db-custom-{cpus}-{ramMb}
  const customMatch = tier.match(/^db-custom-(\d+)-(\d+)$/);
  if (customMatch) {
    const cpus = parseInt(customMatch[1], 10);
    const ramGb = parseInt(customMatch[2], 10) / 1024;
    const hourly = cpus * 0.0413 + ramGb * 0.007;
    return { hourly, monthly: hourly * 730 };
  }

  return { hourly: 0, monthly: 0 };
}

function normalizeStatus(state: string): string {
  switch (state) {
    case 'RUNNABLE':         return 'RUNNING';
    case 'SUSPENDED':        return 'SUSPENDED';
    case 'PENDING_DELETE':   return 'TERMINATED';
    case 'PENDING_CREATE':   return 'STAGING';
    case 'MAINTENANCE':      return 'STOPPED';
    case 'FAILED':           return 'STOPPED';
    case 'ONLINE_MAINTENANCE': return 'RUNNING';
    default:                 return 'UNKNOWN';
  }
}

interface SqlIpAddress {
  ipAddress?: string;
  type?: string;  // "PRIMARY" | "PRIVATE" | "OUTGOING"
}

interface SqlInstanceRaw {
  name?: string;
  databaseVersion?: string;
  state?: string;
  region?: string;
  gceZone?: string;
  settings?: { tier?: string; pricingPlan?: string };
  ipAddresses?: SqlIpAddress[];
  createTime?: string;
  [key: string]: unknown;
}

/**
 * List all Cloud SQL instances in a GCP project.
 */
export async function listCloudSqlInstances(
  projectId: string,
  credentials: Record<string, unknown>,
): Promise<CloudSqlInstance[]> {
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get access token for Cloud SQL API');

  const url = `https://sqladmin.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/instances?maxResults=500`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token.token}` },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Cloud SQL API error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = await resp.json() as { items?: SqlInstanceRaw[] };
  const items: SqlInstanceRaw[] = json.items ?? [];

  return items.map((raw) => {
    const tier = raw.settings?.tier ?? '';
    const state = raw.state ?? 'UNKNOWN';
    const status = normalizeStatus(state);

    const { hourly, monthly } = status === 'RUNNING'
      ? estimateCloudSqlCost(tier)
      : { hourly: 0, monthly: 0 };

    const ips = raw.ipAddresses ?? [];
    const publicIp = ips.find((ip) => ip.type === 'PRIMARY')?.ipAddress ?? null;
    const privateIp = ips.find((ip) => ip.type === 'PRIVATE')?.ipAddress ?? null;

    return {
      instanceId: `cloudsql:${raw.name ?? ''}`,
      name: raw.name ?? '',
      status,
      region: raw.region ?? '',
      zone: raw.gceZone ?? raw.region ?? '',
      machineType: tier,
      databaseVersion: raw.databaseVersion ?? '',
      privateIp: privateIp ?? null,
      publicIp: publicIp ?? null,
      launchedAt: raw.createTime ? new Date(raw.createTime) : null,
      estimatedHourlyCost: hourly,
      estimatedMonthlyCost: monthly,
      rawPayload: raw as Record<string, unknown>,
    };
  });
}
