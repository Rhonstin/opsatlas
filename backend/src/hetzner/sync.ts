/**
 * Hetzner Cloud sync.
 * Uses the Hetzner Cloud REST API (api.hetzner.cloud/v1).
 * Auth: Bearer API token.
 */

export interface HetznerInstance {
  instanceId: string;
  name: string;
  status: string;       // running | off | initializing | starting | stopping | rebuilding | migrating | deleting | unknown
  zone: string;         // datacenter name e.g. "fsn1-dc14"
  region: string;       // location name e.g. "fsn1"
  machineType: string;  // server type name e.g. "cx21"
  privateIp: string | null;
  publicIp: string | null;
  launchedAt: Date | null;
  estimatedHourlyCost: number;
  estimatedMonthlyCost: number;
  rawPayload: Record<string, unknown>;
}

interface ServerPriceEntry {
  location: string;
  price_hourly: { net: string };
  price_monthly: { net: string };
}

interface HetznerServer {
  id: number;
  name: string;
  status: string;
  created: string;
  server_type: {
    name: string;
    cores: number;
    memory: number;
    disk: number;
    prices: ServerPriceEntry[];
  };
  datacenter: { name: string; location: { name: string } };
  public_net: { ipv4: { ip: string } | null; ipv6: { ip: string } | null };
  private_net: Array<{ ip: string }>;
}

/** Normalize Hetzner status strings to uppercase to match our convention. */
function normalizeStatus(s: string): string {
  const map: Record<string, string> = {
    running: 'RUNNING',
    off: 'STOPPED',
    initializing: 'STAGING',
    starting: 'STAGING',
    stopping: 'STOPPING',
    rebuilding: 'STAGING',
    migrating: 'STAGING',
    deleting: 'TERMINATED',
  };
  return map[s] ?? s.toUpperCase();
}

export async function listHetznerServers(
  token: string,
): Promise<HetznerInstance[]> {
  const servers: HetznerServer[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `https://api.hetzner.cloud/v1/servers?page=${page}&per_page=50`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `Hetzner API error ${res.status}`);
    }

    const data = await res.json() as { servers: HetznerServer[]; meta: { pagination: { next_page: number | null } } };
    servers.push(...data.servers);

    if (!data.meta.pagination.next_page) break;
    page = data.meta.pagination.next_page;
  }

  return servers.map((s) => {
    const status = normalizeStatus(s.status);
    const publicIp = s.public_net.ipv4?.ip ?? null;
    const privateIp = s.private_net?.[0]?.ip ?? null;
    const loc = s.datacenter.location.name;
    const priceEntry = s.server_type.prices?.find((p) => p.location === loc)
      ?? s.server_type.prices?.[0];
    const hourly = status === 'RUNNING'
      ? parseFloat(priceEntry?.price_hourly?.net ?? '0')
      : 0;
    const monthly = status === 'RUNNING'
      ? parseFloat(priceEntry?.price_monthly?.net ?? '0')
      : 0;

    return {
      instanceId: String(s.id),
      name: s.name,
      status,
      zone: s.datacenter.name,
      region: s.datacenter.location.name,
      machineType: s.server_type.name,
      privateIp,
      publicIp,
      launchedAt: s.created ? new Date(s.created) : null,
      estimatedHourlyCost: hourly,
      estimatedMonthlyCost: monthly,
      rawPayload: s as unknown as Record<string, unknown>,
    };
  });
}

export async function testHetznerCredentials(token: string): Promise<void> {
  const res = await fetch('https://api.hetzner.cloud/v1/servers?per_page=1', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Hetzner API error ${res.status}`);
  }
}

// Real prices come from server_type.prices in the API response — no hardcoded table needed.
