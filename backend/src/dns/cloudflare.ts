import { fetchWithTimeout } from '../lib/http';

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

export interface CloudflareRecord {
  id: string;
  zone_id: string;
  zone_name: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

interface CfResultInfo {
  page: number;
  per_page: number;
  total_pages: number;
}

interface CfResponse<T> {
  success: boolean;
  result: T;
  result_info?: CfResultInfo;
  errors: { message: string }[];
}

async function cfFetch<T>(path: string, apiToken: string): Promise<CfResponse<T>> {
  const res = await fetchWithTimeout(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const data = (await res.json()) as CfResponse<T>;
  if (!data.success) {
    throw new Error(data.errors?.[0]?.message ?? 'Cloudflare API error');
  }
  return data;
}

/**
 * Fetch every page of a paginated Cloudflare list endpoint.
 * `path` must already contain `per_page` and any filters; `page` is appended.
 */
async function cfFetchAll<T>(path: string, apiToken: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  // total_pages is authoritative; cap at 1000 pages as a runaway guard
  for (let guard = 0; guard < 1000; guard++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await cfFetch<T[]>(`${path}${sep}page=${page}`, apiToken);
    items.push(...(data.result ?? []));
    const totalPages = data.result_info?.total_pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }
  return items;
}

/**
 * Validate a Cloudflare API token by listing zones.
 * /user/tokens/verify requires User:User Tokens:Read which zone-scoped tokens don't have.
 * /zones?per_page=1 works with any valid Zone-level token.
 */
export async function testCloudflareToken(apiToken: string): Promise<void> {
  await cfFetch('/zones?per_page=1', apiToken);
}

/** List all zones the token has access to (paginated). */
export async function listCloudflareZones(apiToken: string): Promise<CloudflareZone[]> {
  return cfFetchAll<CloudflareZone>('/zones?per_page=50', apiToken);
}

/**
 * List all DNS records for a zone (paginated, all record types).
 * A/AAAA drive instance↔domain mapping; TXT/MX/etc are stored for completeness.
 */
export async function listCloudflareRecords(
  apiToken: string,
  zoneId: string,
): Promise<CloudflareRecord[]> {
  return cfFetchAll<CloudflareRecord>(`/zones/${zoneId}/dns_records?per_page=100`, apiToken);
}
