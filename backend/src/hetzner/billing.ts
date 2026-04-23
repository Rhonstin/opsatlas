/**
 * Hetzner Cloud billing — computes monthly spend from live resource usage
 * and Hetzner's own pricing API.
 *
 * The Cloud API has no invoice endpoint. Instead:
 *   1. GET /pricing  — official prices for volumes, floating IPs, etc.
 *   2. GET /servers  — each server embeds its own location-specific prices
 *   3. GET /volumes, /floating_ips, /primary_ips, /load_balancers
 *   4. Prorate each resource: max(created, period_start) → min(now, period_end)
 *
 * Amounts are in EUR; currency field is set to 'EUR'.
 */

export interface HetznerBillingRow {
  project_id: null;
  project_name: null;
  service: string;
  amount_usd: number; // EUR — see currency field
  currency: 'EUR';
}

// ── API response types (exact shape verified against live API) ─────────────

interface PriceEntry { net: string }

interface ServerPriceLocation {
  location: string;
  price_hourly: PriceEntry;
  price_monthly: PriceEntry;
}

interface HetznerServer {
  id: number;
  name: string;
  created: string;
  status: string;
  server_type: {
    name: string;
    prices: ServerPriceLocation[];
  };
  datacenter: {
    location: { name: string };
  };
}

interface HetznerVolume {
  id: number;
  created: string;
  size: number; // GB
}

interface HetznerFloatingIp {
  id: number;
  created: string;
}

interface HetznerPrimaryIp {
  id: number;
  created: string;
  assignee_id: number | null;
  type: string;
  datacenter: { location: { name: string } };
}

interface HetznerLoadBalancer {
  id: number;
  created: string;
  load_balancer_type: {
    name: string;
    prices: ServerPriceLocation[];
  };
  location: { name: string };
}

interface PricingResponse {
  pricing: {
    volume: { price_per_gb_month: PriceEntry } | null;
    floating_ip: { price_monthly: PriceEntry } | null;
    primary_ips: Array<{
      type: string;
      prices: Array<{ location: string; price_hourly: PriceEntry }>;
    }>;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function net(entry: PriceEntry): number {
  return parseFloat(entry.net);
}

async function hetznerGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.hetzner.cloud/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Hetzner API ${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function fetchPaged<T>(token: string, path: string, key: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await hetznerGet<Record<string, unknown>>(token, `${path}${sep}page=${page}&per_page=50`);
    items.push(...(data[key] as T[]));
    const pagination = (data.meta as { pagination: { next_page: number | null } })?.pagination;
    if (!pagination?.next_page) break;
    page = pagination.next_page;
  }
  return items;
}

function billingStartMs(createdIso: string, periodStartMs: number): number {
  return Math.max(new Date(createdIso).getTime(), periodStartMs);
}

function hoursInPeriod(createdIso: string, periodStartMs: number, periodEndMs: number): number {
  const start = billingStartMs(createdIso, periodStartMs);
  return Math.max(0, (periodEndMs - start) / 3_600_000);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchHetznerBillingActuals(
  token: string,
  period: string, // "YYYY-MM"
): Promise<HetznerBillingRow[]> {
  const [y, m] = period.split('-').map(Number);
  const pStartMs = Date.UTC(y, m - 1, 1);
  const pEndMs = Math.min(Date.now(), Date.UTC(y, m, 1)); // end of month or now

  if (pEndMs <= pStartMs) return []; // future period

  const [pricing, servers, volumes, floatingIps, primaryIps, loadBalancers] = await Promise.all([
    hetznerGet<PricingResponse>(token, '/pricing'),
    fetchPaged<HetznerServer>(token, '/servers', 'servers'),
    fetchPaged<HetznerVolume>(token, '/volumes', 'volumes'),
    fetchPaged<HetznerFloatingIp>(token, '/floating_ips', 'floating_ips'),
    fetchPaged<HetznerPrimaryIp>(token, '/primary_ips', 'primary_ips'),
    fetchPaged<HetznerLoadBalancer>(token, '/load_balancers', 'load_balancers').catch(() => [] as HetznerLoadBalancer[]),
  ]);

  const p = pricing.pricing;
  const totals: Record<string, number> = {};

  function add(service: string, amount: number) {
    if (amount > 0) totals[service] = (totals[service] ?? 0) + amount;
  }

  // Servers — price is embedded per-server, matched by datacenter location
  for (const server of servers) {
    if (new Date(server.created).getTime() >= pEndMs) continue;
    const loc = server.datacenter.location.name;
    const priceEntry = server.server_type.prices.find((p) => p.location === loc);
    if (!priceEntry) continue;
    const hours = hoursInPeriod(server.created, pStartMs, pEndMs);
    add('Server', net(priceEntry.price_hourly) * hours);
  }

  // Volumes — global €/GB/month rate
  const volHourlyPerGb = p.volume ? net(p.volume.price_per_gb_month) / 730 : 0;
  for (const vol of volumes) {
    if (new Date(vol.created).getTime() >= pEndMs) continue;
    const hours = hoursInPeriod(vol.created, pStartMs, pEndMs);
    add('Volume', volHourlyPerGb * vol.size * hours);
  }

  // Floating IPs — global monthly rate
  const fipHourly = p.floating_ip ? net(p.floating_ip.price_monthly) / 730 : 0;
  for (const fip of floatingIps) {
    if (new Date(fip.created).getTime() >= pEndMs) continue;
    const hours = hoursInPeriod(fip.created, pStartMs, pEndMs);
    add('Floating IP', fipHourly * hours);
  }

  // Primary IPs — only unassigned ones are billed separately
  // (assigned to running server = included in server price)
  const pip4Entry = p.primary_ips?.find((e) => e.type === 'ipv4');
  const pip4Hourly = pip4Entry?.prices?.[0]
    ? net(pip4Entry.prices[0].price_hourly)
    : 0;
  for (const pip of primaryIps) {
    if (pip.assignee_id !== null) continue; // assigned = free
    if (new Date(pip.created).getTime() >= pEndMs) continue;
    const hours = hoursInPeriod(pip.created, pStartMs, pEndMs);
    add('Primary IP', pip4Hourly * hours);
  }

  // Load Balancers — price embedded per-LB, matched by location
  for (const lb of loadBalancers) {
    if (new Date(lb.created).getTime() >= pEndMs) continue;
    const loc = lb.location.name;
    const priceEntry = lb.load_balancer_type.prices.find((p) => p.location === loc);
    if (!priceEntry) continue;
    const hours = hoursInPeriod(lb.created, pStartMs, pEndMs);
    add('Load Balancer', net(priceEntry.price_hourly) * hours);
  }

  return Object.entries(totals)
    .map(([service, amount]) => ({
      project_id: null,
      project_name: null,
      service,
      amount_usd: Math.round(amount * 10000) / 10000,
      currency: 'EUR' as const,
    }))
    .sort((a, b) => b.amount_usd - a.amount_usd);
}
