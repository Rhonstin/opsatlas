/**
 * AWS EC2 on-demand pricing via the AWS Pricing API.
 *
 * The Pricing API is only available in us-east-1 (global endpoint).
 * Results are cached in the `aws_price_cache` DB table (TTL: 24 h).
 * In-process Map avoids repeat DB reads within the same sync run.
 */
import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import type { Knex } from 'knex';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// In-process cache: "region:instanceType" → hourly price
const memCache = new Map<string, number>();

/** AWS region code → Pricing API location name */
const REGION_TO_LOCATION: Record<string, string> = {
  'us-east-1':      'US East (N. Virginia)',
  'us-east-2':      'US East (Ohio)',
  'us-west-1':      'US West (N. California)',
  'us-west-2':      'US West (Oregon)',
  'ca-central-1':   'Canada (Central)',
  'ca-west-1':      'Canada West (Calgary)',
  'eu-west-1':      'Europe (Ireland)',
  'eu-west-2':      'Europe (London)',
  'eu-west-3':      'Europe (Paris)',
  'eu-central-1':   'Europe (Frankfurt)',
  'eu-central-2':   'Europe (Zurich)',
  'eu-north-1':     'Europe (Stockholm)',
  'eu-south-1':     'Europe (Milan)',
  'eu-south-2':     'Europe (Spain)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-southeast-3': 'Asia Pacific (Jakarta)',
  'ap-southeast-4': 'Asia Pacific (Melbourne)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-northeast-3': 'Asia Pacific (Osaka)',
  'ap-south-1':     'Asia Pacific (Mumbai)',
  'ap-south-2':     'Asia Pacific (Hyderabad)',
  'ap-east-1':      'Asia Pacific (Hong Kong)',
  'sa-east-1':      'South America (Sao Paulo)',
  'me-south-1':     'Middle East (Bahrain)',
  'me-central-1':   'Middle East (UAE)',
  'af-south-1':     'Africa (Cape Town)',
  'il-central-1':   'Israel (Tel Aviv)',
  'mx-central-1':   'Mexico (Central)',
};

/**
 * Load all non-stale entries from DB into the in-process cache.
 * Call once at the start of a sync run.
 */
export async function warmPriceCache(db: Knex): Promise<void> {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);
  const rows = await db('aws_price_cache')
    .where('fetched_at', '>=', cutoff)
    .select('instance_type', 'region', 'price_hourly');
  for (const row of rows) {
    memCache.set(`${row.region}:${row.instance_type}`, parseFloat(row.price_hourly));
  }
}

/**
 * Fetch real on-demand Linux prices for a batch of (region, instanceType) pairs.
 * Unknown types are skipped gracefully.
 */
export async function fetchPrices(
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
  regionInstancePairs: Array<{ region: string; instanceType: string }>,
  db: Knex,
): Promise<void> {
  // Group by region for batched API calls
  const byRegion = new Map<string, Set<string>>();
  for (const { region, instanceType } of regionInstancePairs) {
    const key = `${region}:${instanceType}`;
    if (memCache.has(key)) continue; // already warm
    const types = byRegion.get(region) ?? new Set<string>();
    types.add(instanceType);
    byRegion.set(region, types);
  }

  if (byRegion.size === 0) return;

  // Pricing API only works from us-east-1
  const client = new PricingClient({
    region: 'us-east-1',
    credentials,
  });

  for (const [region, types] of byRegion) {
    const location = REGION_TO_LOCATION[region];
    if (!location) continue; // unknown region — skip

    for (const instanceType of types) {
      const key = `${region}:${instanceType}`;
      try {
        const cmd = new GetProductsCommand({
          ServiceCode: 'AmazonEC2',
          Filters: [
            { Type: 'TERM_MATCH', Field: 'instanceType',    Value: instanceType },
            { Type: 'TERM_MATCH', Field: 'location',        Value: location },
            { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
            { Type: 'TERM_MATCH', Field: 'tenancy',         Value: 'Shared' },
            { Type: 'TERM_MATCH', Field: 'capacitystatus',  Value: 'Used' },
            { Type: 'TERM_MATCH', Field: 'preInstalledSw',  Value: 'NA' },
          ],
          MaxResults: 1,
        });
        const resp = await client.send(cmd);

        let hourly = 0;
        for (const priceStr of resp.PriceList ?? []) {
          const priceDoc = JSON.parse(priceStr) as {
            terms?: { OnDemand?: Record<string, { priceDimensions?: Record<string, { pricePerUnit?: { USD?: string } }> }> };
          };
          const onDemand = priceDoc.terms?.OnDemand;
          if (!onDemand) continue;
          for (const term of Object.values(onDemand)) {
            for (const dim of Object.values(term.priceDimensions ?? {})) {
              const usd = parseFloat(dim.pricePerUnit?.USD ?? '0');
              if (usd > 0) { hourly = usd; break; }
            }
            if (hourly > 0) break;
          }
          if (hourly > 0) break;
        }

        if (hourly > 0) {
          memCache.set(key, hourly);
          await db('aws_price_cache')
            .insert({ instance_type: instanceType, region, price_hourly: hourly, fetched_at: new Date() })
            .onConflict(['instance_type', 'region'])
            .merge(['price_hourly', 'fetched_at']);
        }
      } catch (err) {
        // Non-fatal: pricing API may not be accessible (missing permission)
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[aws pricing] ${instanceType} @ ${region}: ${msg.split('\n')[0]}`);
      }
    }
  }
}

/**
 * Look up a cached price. Returns undefined if not in cache.
 */
export function getCachedPrice(region: string, instanceType: string): number | undefined {
  return memCache.get(`${region}:${instanceType}`);
}
