/**
 * GCP Compute Engine sync.
 * Ported from gcp-vm-janitor/compute.py — uses aggregatedList to get
 * all instances across all zones in a project.
 */
import { InstancesClient } from '@google-cloud/compute';
import { estimateCost } from './cost';

export interface GcpInstance {
  instanceId: string;
  name: string;
  status: string;
  zone: string;
  region: string;
  machineType: string;
  privateIp: string | null;
  publicIp: string | null;
  launchedAt: Date | null;
  estimatedHourlyCost: number;
  estimatedMonthlyCost: number;
  rawPayload: Record<string, unknown>;
}

/** Parse a GCP resource URL to its last path segment. */
function shortName(resourceUrl: string): string {
  return resourceUrl.replace(/\/$/, '').split('/').at(-1) ?? resourceUrl;
}

/** Extract region from zone name, e.g. "us-central1-a" -> "us-central1" */
function zoneToRegion(zone: string): string {
  return zone.split('-').slice(0, -1).join('-');
}

/**
 * List all Compute Engine instances in a GCP project.
 * Credentials are passed as a parsed service account JSON object.
 * Pass `priceCache` (from loadPriceCache()) for live billing prices.
 */
export async function listGcpInstances(
  projectId: string,
  credentials: Record<string, unknown>,
  priceCache?: Map<string, number>,
): Promise<GcpInstance[]> {
  const client = new InstancesClient({ credentials });

  const instances: GcpInstance[] = [];

  const iterable = client.aggregatedListAsync({ project: projectId });

  for await (const [zoneKey, scopedList] of iterable) {
    if (!scopedList.instances?.length) continue;

    const zone = shortName(zoneKey); // "zones/us-central1-a" -> "us-central1-a"
    const region = zoneToRegion(zone);

    for (const inst of scopedList.instances) {
      const machineType = shortName(inst.machineType ?? '');
      const status = inst.status ?? 'UNKNOWN';
      // TERMINATED/STOPPED instances incur no compute cost
      const { hourly, monthly } = status === 'RUNNING'
        ? estimateCost(machineType, region, priceCache)
        : { hourly: 0, monthly: 0 };

      // Persistent disk cost — charged regardless of instance status.
      // Rates (us-central1, $/GB/month): pd-standard $0.04, pd-balanced $0.10, pd-ssd $0.17.
      // We default to pd-balanced ($0.10) when the exact type is unknown.
      let diskMonthly = 0;
      for (const disk of inst.disks ?? []) {
        if (disk.type !== 'PERSISTENT') continue;
        const sizeGb = parseInt(String(disk.diskSizeGb ?? '0'), 10);
        if (!sizeGb) continue;
        // Detect disk kind from the source URL suffix (pd-standard / pd-ssd / pd-balanced / pd-extreme)
        const src = String(disk.source ?? '');
        const diskKind = src.includes('pd-ssd') ? 'pd-ssd'
          : src.includes('pd-standard') ? 'pd-standard'
          : src.includes('pd-extreme') ? 'pd-extreme'
          : 'pd-balanced';
        const ratePerGb = diskKind === 'pd-ssd' ? 0.17
          : diskKind === 'pd-standard' ? 0.04
          : diskKind === 'pd-extreme' ? 0.125
          : 0.10; // pd-balanced default
        diskMonthly += sizeGb * ratePerGb;
      }

      // Primary network interface IPs
      const nic0 = inst.networkInterfaces?.[0];
      const privateIp = nic0?.networkIP ?? null;
      const publicIp = nic0?.accessConfigs?.[0]?.natIP ?? null;

      let launchedAt: Date | null = null;
      if (inst.creationTimestamp) {
        launchedAt = new Date(inst.creationTimestamp);
      }

      const totalHourly = hourly + diskMonthly / 730;
      const totalMonthly = monthly + diskMonthly;

      instances.push({
        instanceId: String(inst.id ?? inst.name),
        name: inst.name ?? '',
        status,
        zone,
        region,
        machineType,
        privateIp: privateIp || null,
        publicIp: publicIp || null,
        launchedAt,
        estimatedHourlyCost: totalHourly,
        estimatedMonthlyCost: totalMonthly,
        rawPayload: inst as Record<string, unknown>,
      });
    }
  }

  return instances;
}

/** Validate GCP credentials by making a real API call. */
export async function testGcpCredentials(
  projectId: string,
  credentials: Record<string, unknown>,
): Promise<void> {
  const client = new InstancesClient({ credentials });
  // Same pattern as listGcpInstances — iterate once then break
  for await (const _ of client.aggregatedListAsync({ project: projectId })) {
    break;
  }
}
