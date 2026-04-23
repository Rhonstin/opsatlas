/**
 * AWS EC2 sync.
 * Credentials: { access_key_id, secret_access_key, region }
 */
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeRegionsCommand,
  type Instance as EC2Instance,
} from '@aws-sdk/client-ec2';
import db from '../db';
import { warmPriceCache, fetchPrices, getCachedPrice } from './pricing';

export interface AwsInstance {
  instanceId: string;
  name: string;
  status: string;
  region: string;
  zone: string;
  machineType: string;
  privateIp: string | null;
  publicIp: string | null;
  launchedAt: Date | null;
  estimatedHourlyCost: number;
  estimatedMonthlyCost: number;
  rawPayload: Record<string, unknown>;
}

function makeClient(credentials: Record<string, unknown>, region: string): EC2Client {
  return new EC2Client({
    region,
    credentials: {
      accessKeyId: credentials.access_key_id as string,
      secretAccessKey: credentials.secret_access_key as string,
      ...(credentials.session_token ? { sessionToken: credentials.session_token as string } : {}),
    },
  });
}

function normalizeStatus(state: string): string {
  const map: Record<string, string> = {
    running: 'RUNNING',
    stopped: 'STOPPED',
    terminated: 'TERMINATED',
    pending: 'STAGING',
    'shutting-down': 'STOPPING',
    stopping: 'STOPPING',
    rebooting: 'RUNNING',
    hibernated: 'STOPPED',
  };
  return map[state] ?? state.toUpperCase();
}

function getTagValue(tags: Array<{ Key?: string; Value?: string }> | undefined, key: string): string | null {
  return tags?.find((t) => t.Key === key)?.Value ?? null;
}

function regionFromAz(az: string): string {
  // us-east-1a -> us-east-1
  return az.replace(/[a-z]$/, '');
}

/**
 * List all EC2 instances in a given region.
 */
async function listInstancesInRegion(
  client: EC2Client,
  region: string,
): Promise<AwsInstance[]> {
  const results: AwsInstance[] = [];
  let nextToken: string | undefined;

  do {
    const cmd = new DescribeInstancesCommand({
      MaxResults: 1000,
      NextToken: nextToken,
    });
    const resp = await client.send(cmd);

    for (const reservation of resp.Reservations ?? []) {
      for (const inst of reservation.Instances ?? []) {
        results.push(normalizeInstance(inst, region));
      }
    }

    nextToken = resp.NextToken;
  } while (nextToken);

  return results;
}

function normalizeInstance(inst: EC2Instance, region: string): AwsInstance {
  const az = inst.Placement?.AvailabilityZone ?? region;
  const derivedRegion = regionFromAz(az);
  const status = normalizeStatus(inst.State?.Name ?? 'unknown');
  const machineType = inst.InstanceType ?? 'unknown';

  // Use real price from cache, fall back to static table
  const hourly = status === 'RUNNING'
    ? (getCachedPrice(derivedRegion, machineType) ?? estimateEc2HourlyCost(machineType))
    : 0;

  return {
    instanceId: inst.InstanceId ?? 'unknown',
    name: getTagValue(inst.Tags, 'Name') ?? inst.InstanceId ?? 'unknown',
    status,
    region: derivedRegion,
    zone: az,
    machineType,
    privateIp: inst.PrivateIpAddress ?? null,
    publicIp: inst.PublicIpAddress ?? null,
    launchedAt: inst.LaunchTime ? new Date(inst.LaunchTime) : null,
    estimatedHourlyCost: hourly,
    estimatedMonthlyCost: hourly * 730,
    rawPayload: inst as unknown as Record<string, unknown>,
  };
}

/**
 * Fetch all EC2 instances.
 * If credentials include a region, syncs only that region.
 * Otherwise iterates all enabled regions.
 */
export async function listAwsInstances(
  credentials: Record<string, unknown>,
): Promise<AwsInstance[]> {
  const homeRegion = (credentials.region as string | undefined) || 'us-east-1';
  const all: AwsInstance[] = [];

  // Warm in-process price cache from DB
  try { await warmPriceCache(db); } catch { /* non-fatal */ }

  // Discover enabled regions using the home region client
  const homeClient = makeClient(credentials, homeRegion);
  let regions: string[];

  try {
    const resp = await homeClient.send(new DescribeRegionsCommand({ AllRegions: false }));
    regions = (resp.Regions ?? []).map((r) => r.RegionName!).filter(Boolean);
  } catch {
    regions = [homeRegion];
  }

  await Promise.allSettled(
    regions.map(async (region) => {
      const client = makeClient(credentials, region);
      try {
        const instances = await listInstancesInRegion(client, region);
        all.push(...instances);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[aws] region ${region} skipped: ${msg.split('\n')[0]}`);
      }
    }),
  );

  // Fetch real prices for any instance types not already cached
  const pricingCreds = {
    accessKeyId: credentials.access_key_id as string,
    secretAccessKey: credentials.secret_access_key as string,
    ...(credentials.session_token ? { sessionToken: credentials.session_token as string } : {}),
  };
  const pairs = all
    .filter((i) => i.status === 'RUNNING')
    .map((i) => ({ region: i.region, instanceType: i.machineType }));

  try {
    await fetchPrices(pricingCreds, pairs, db);
  } catch { /* non-fatal — static table remains as fallback */ }

  // Re-price instances that now have a real cached price
  for (const inst of all) {
    if (inst.status !== 'RUNNING') continue;
    const real = getCachedPrice(inst.region, inst.machineType);
    if (real !== undefined) {
      inst.estimatedHourlyCost = real;
      inst.estimatedMonthlyCost = real * 730;
    }
  }

  return all;
}

/**
 * Test AWS credentials by doing a lightweight DescribeRegions call.
 */
export async function testAwsCredentials(credentials: Record<string, unknown>): Promise<void> {
  const region = (credentials.region as string | undefined) || 'us-east-1';
  const client = makeClient(credentials, region);
  await client.send(new DescribeRegionsCommand({ AllRegions: false }));
}

// ── EC2 on-demand pricing (us-east-1, Linux, 2024) ─────────────────────────
// Source: https://aws.amazon.com/ec2/pricing/on-demand/
const EC2_RATES: Record<string, number> = {
  // General purpose — T series (burstable)
  't2.nano': 0.0058, 't2.micro': 0.0116, 't2.small': 0.023, 't2.medium': 0.0464,
  't2.large': 0.0928, 't2.xlarge': 0.1856, 't2.2xlarge': 0.3712,
  't3.nano': 0.0052, 't3.micro': 0.0104, 't3.small': 0.0208, 't3.medium': 0.0416,
  't3.large': 0.0832, 't3.xlarge': 0.1664, 't3.2xlarge': 0.3328,
  't3a.nano': 0.0047, 't3a.micro': 0.0094, 't3a.small': 0.0188, 't3a.medium': 0.0376,
  't3a.large': 0.0752, 't3a.xlarge': 0.1504, 't3a.2xlarge': 0.3008,
  't4g.nano': 0.0042, 't4g.micro': 0.0084, 't4g.small': 0.0168, 't4g.medium': 0.0336,
  't4g.large': 0.0672, 't4g.xlarge': 0.1344, 't4g.2xlarge': 0.2688,
  // General purpose — M series
  'm5.large': 0.096, 'm5.xlarge': 0.192, 'm5.2xlarge': 0.384, 'm5.4xlarge': 0.768,
  'm5.8xlarge': 1.536, 'm5.12xlarge': 2.304, 'm5.16xlarge': 3.072, 'm5.24xlarge': 4.608,
  'm5a.large': 0.086, 'm5a.xlarge': 0.172, 'm5a.2xlarge': 0.344, 'm5a.4xlarge': 0.688,
  'm6i.large': 0.096, 'm6i.xlarge': 0.192, 'm6i.2xlarge': 0.384, 'm6i.4xlarge': 0.768,
  'm6i.8xlarge': 1.536, 'm6i.12xlarge': 2.304, 'm6i.16xlarge': 3.072, 'm6i.24xlarge': 4.608,
  'm6a.large': 0.0864, 'm6a.xlarge': 0.1728, 'm6a.2xlarge': 0.3456, 'm6a.4xlarge': 0.6912,
  'm7i.large': 0.1008, 'm7i.xlarge': 0.2016, 'm7i.2xlarge': 0.4032, 'm7i.4xlarge': 0.8064,
  'm7g.medium': 0.0535, 'm7g.large': 0.1069, 'm7g.xlarge': 0.2139, 'm7g.2xlarge': 0.4278,
  // Compute optimized — C series
  'c5.large': 0.085, 'c5.xlarge': 0.17, 'c5.2xlarge': 0.34, 'c5.4xlarge': 0.68,
  'c5.9xlarge': 1.53, 'c5.12xlarge': 2.04, 'c5.18xlarge': 3.06, 'c5.24xlarge': 4.08,
  'c5a.large': 0.077, 'c5a.xlarge': 0.154, 'c5a.2xlarge': 0.308, 'c5a.4xlarge': 0.616,
  'c6i.large': 0.085, 'c6i.xlarge': 0.17, 'c6i.2xlarge': 0.34, 'c6i.4xlarge': 0.68,
  'c6a.large': 0.0765, 'c6a.xlarge': 0.153, 'c6a.2xlarge': 0.306, 'c6a.4xlarge': 0.612,
  'c7i.large': 0.08925, 'c7i.xlarge': 0.1785, 'c7i.2xlarge': 0.357, 'c7i.4xlarge': 0.714,
  'c7g.medium': 0.0362, 'c7g.large': 0.0725, 'c7g.xlarge': 0.145, 'c7g.2xlarge': 0.29,
  // Memory optimized — R series
  'r5.large': 0.126, 'r5.xlarge': 0.252, 'r5.2xlarge': 0.504, 'r5.4xlarge': 1.008,
  'r5.8xlarge': 2.016, 'r5.12xlarge': 3.024, 'r5.16xlarge': 4.032, 'r5.24xlarge': 6.048,
  'r5a.large': 0.113, 'r5a.xlarge': 0.226, 'r5a.2xlarge': 0.452, 'r5a.4xlarge': 0.904,
  'r6i.large': 0.126, 'r6i.xlarge': 0.252, 'r6i.2xlarge': 0.504, 'r6i.4xlarge': 1.008,
  'r6a.large': 0.1134, 'r6a.xlarge': 0.2268, 'r6a.2xlarge': 0.4536, 'r6a.4xlarge': 0.9072,
  'r7i.large': 0.1323, 'r7i.xlarge': 0.2646, 'r7i.2xlarge': 0.5292, 'r7i.4xlarge': 1.0584,
  'r7g.medium': 0.0635, 'r7g.large': 0.127, 'r7g.xlarge': 0.254, 'r7g.2xlarge': 0.508,
  // Memory optimized — X series
  'x1e.xlarge': 0.834, 'x1e.2xlarge': 1.668, 'x1e.4xlarge': 3.336,
  // Storage optimized — I series
  'i3.large': 0.156, 'i3.xlarge': 0.312, 'i3.2xlarge': 0.624, 'i3.4xlarge': 1.248,
  'i3.8xlarge': 2.496, 'i3.16xlarge': 4.992,
  'i4i.large': 0.1557, 'i4i.xlarge': 0.3113, 'i4i.2xlarge': 0.6226, 'i4i.4xlarge': 1.2451,
  // GPU instances
  'p3.2xlarge': 3.06, 'p3.8xlarge': 12.24, 'p3.16xlarge': 24.48,
  'p4d.24xlarge': 32.77,
  'g4dn.xlarge': 0.526, 'g4dn.2xlarge': 0.752, 'g4dn.4xlarge': 1.204,
  'g5.xlarge': 1.006, 'g5.2xlarge': 1.212, 'g5.4xlarge': 1.624, 'g5.8xlarge': 2.448,
};

/**
 * Estimate EC2 hourly cost from the static rate table.
 * Falls back to a vCPU-based heuristic for unknown types.
 */
function estimateEc2HourlyCost(instanceType: string): number {
  const known = EC2_RATES[instanceType.toLowerCase()];
  if (known !== undefined) return known;

  // Heuristic fallback: parse size multiplier from the type name
  // e.g. m5.4xlarge -> family=m5, size=4xlarge -> ~0.768/hr
  const sizeMap: Record<string, number> = {
    nano: 0.005, micro: 0.01, small: 0.02, medium: 0.04,
    large: 0.08, xlarge: 0.16, '2xlarge': 0.32, '4xlarge': 0.64,
    '8xlarge': 1.28, '12xlarge': 1.92, '16xlarge': 2.56,
    '24xlarge': 3.84, '32xlarge': 5.12, '48xlarge': 7.68,
  };
  const parts = instanceType.toLowerCase().split('.');
  const size = parts[parts.length - 1];
  return sizeMap[size] ?? 0.1;
}
