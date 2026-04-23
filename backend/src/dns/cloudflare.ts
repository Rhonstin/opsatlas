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

async function cfFetch(path: string, apiToken: string): Promise<unknown> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const data = (await res.json()) as { success: boolean; result: unknown; errors: { message: string }[] };
  if (!data.success) {
    throw new Error(data.errors?.[0]?.message ?? 'Cloudflare API error');
  }
  return data.result;
}

/**
 * Validate a Cloudflare API token by listing zones.
 * /user/tokens/verify requires User:User Tokens:Read which zone-scoped tokens don't have.
 * /zones?per_page=1 works with any valid Zone-level token.
 */
export async function testCloudflareToken(apiToken: string): Promise<void> {
  await cfFetch('/zones?per_page=1', apiToken);
}

/** List all zones the token has access to. */
export async function listCloudflareZones(apiToken: string): Promise<CloudflareZone[]> {
  return cfFetch('/zones?per_page=100', apiToken) as Promise<CloudflareZone[]>;
}

/** List A, AAAA, and CNAME records for a zone. */
export async function listCloudflareRecords(
  apiToken: string,
  zoneId: string,
): Promise<CloudflareRecord[]> {
  return cfFetch(
    `/zones/${zoneId}/dns_records?type=A,AAAA,CNAME&per_page=1000`,
    apiToken,
  ) as Promise<CloudflareRecord[]>;
}
