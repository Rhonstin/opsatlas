/**
 * GCP Billing Catalog API integration.
 * Fetches on-demand compute pricing from the public SKU catalog
 * (no billing account permissions required) and caches it in DB.
 *
 * Service: Compute Engine — 6F81-5844-456A
 */
import { GoogleAuth } from 'google-auth-library';
import { Knex } from 'knex';

const COMPUTE_SERVICE_ID = '6F81-5844-456A';
const BILLING_API = `https://cloudbilling.googleapis.com/v1/services/${COMPUTE_SERVICE_ID}/skus`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Ordered so longer prefixes match first (n2d before n2)
const FAMILY_PREFIXES: [string, string][] = [
  ['N2D ', 'n2d'], ['N2 ', 'n2'], ['N1 ', 'n1'], ['N4 ', 'n4'],
  ['E2 ', 'e2'],
  ['C2D ', 'c2d'], ['C2 ', 'c2'],
  ['M2 ', 'm2'], ['M1 ', 'm1'],
  ['T2D ', 't2d'], ['T2A ', 't2a'],
];

const REGION_SUFFIXES: [string, string][] = [
  ['in Americas', 'americas'],
  ['in Europe', 'europe'],
  ['in Asia Pacific', 'apac'],
  ['in EMEA', 'emea'],
];

interface SkuUnitPrice {
  units?: string;   // string representation of int64
  nanos?: number;
}

interface Sku {
  description: string;
  category?: { usageType?: string; resourceFamily?: string };
  pricingInfo?: Array<{
    pricingExpression?: {
      usageUnit?: string;
      tieredRates?: Array<{ unitPrice?: SkuUnitPrice }>;
    };
  }>;
}

interface SkuResponse {
  skus?: Sku[];
  nextPageToken?: string;
}

function parseSku(
  sku: Sku,
): { family: string; resource: 'cpu' | 'ram'; regionGroup: string; price: number } | null {
  const { description, category, pricingInfo } = sku;

  if (category?.usageType !== 'OnDemand') return null;
  if (category?.resourceFamily !== 'Compute') return null;

  const isCpu = description.includes(' Core ');
  const isRam = description.includes(' Ram ');
  if (!isCpu && !isRam) return null;

  const descLower = description.toLowerCase();
  if (descLower.includes('preemptible') || descLower.includes('spot')) return null;

  // Extract machine family
  let family: string | null = null;
  for (const [prefix, fam] of FAMILY_PREFIXES) {
    if (description.startsWith(prefix)) { family = fam; break; }
  }
  if (!family) return null;

  // Extract region group
  let regionGroup: string | null = null;
  for (const [suffix, rg] of REGION_SUFFIXES) {
    if (description.endsWith(suffix)) { regionGroup = rg; break; }
  }
  if (!regionGroup) return null;

  // Extract price from first tiered rate
  const rates = pricingInfo?.[0]?.pricingExpression?.tieredRates;
  if (!rates?.length) return null;
  const up = rates[0].unitPrice;
  const price = parseInt(up?.units ?? '0') + (up?.nanos ?? 0) / 1e9;
  if (price <= 0) return null;

  return { family, resource: isCpu ? 'cpu' : 'ram', regionGroup, price };
}

/**
 * Fetch all Compute Engine SKUs from the billing catalog and upsert into DB.
 * Safe to call on every sync — no-ops if cache is fresh.
 */
export async function refreshBillingCache(
  credentials: Record<string, unknown>,
  db: Knex,
): Promise<void> {
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();

  let pageToken: string | undefined;
  const entries: { family: string; resource: string; region_group: string; price: number }[] = [];

  do {
    const url = new URL(BILLING_API);
    url.searchParams.set('pageSize', '5000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await (client as { request: (opts: { url: string }) => Promise<{ data: SkuResponse }> }).request({
      url: url.toString(),
    });
    const data = response.data;

    for (const sku of data.skus ?? []) {
      const parsed = parseSku(sku);
      if (parsed) {
        entries.push({
          family: parsed.family,
          resource: parsed.resource,
          region_group: parsed.regionGroup,
          price: parsed.price,
        });
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  if (!entries.length) return;

  const now = new Date();
  // Upsert each entry — on conflict update price and fetched_at
  for (const entry of entries) {
    await db('billing_price_cache')
      .insert({ ...entry, fetched_at: now })
      .onConflict(['family', 'resource', 'region_group'])
      .merge(['price', 'fetched_at']);
  }
}

/**
 * Load the cached pricing into an in-memory Map keyed by
 * `${family}:${resource}:${regionGroup}` for O(1) lookup.
 */
export async function loadPriceCache(db: Knex): Promise<Map<string, number>> {
  const rows = await db('billing_price_cache').select(
    'family', 'resource', 'region_group', 'price',
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.family}:${row.resource}:${row.region_group}`, parseFloat(row.price));
  }
  return map;
}

/** Returns true if the cache is empty or older than CACHE_TTL_MS. */
export async function isCacheStale(db: Knex): Promise<boolean> {
  const row = await db('billing_price_cache').max('fetched_at as last_fetch').first();
  if (!row?.last_fetch) return true;
  const ageMs = Date.now() - new Date(row.last_fetch as string).getTime();
  return ageMs > CACHE_TTL_MS;
}
