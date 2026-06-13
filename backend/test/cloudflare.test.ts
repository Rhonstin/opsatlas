/**
 * M17: Cloudflare zone/record listing must follow pagination (result_info.total_pages)
 * instead of silently truncating at the first page.
 */
import { vi, beforeEach, describe, expect, it } from 'vitest';

vi.mock('../src/lib/http', () => ({ fetchWithRetry: vi.fn() }));

import { listCloudflareZones, listCloudflareRecords } from '../src/dns/cloudflare';
import { fetchWithRetry } from '../src/lib/http';

const fetchMock = fetchWithRetry as unknown as ReturnType<typeof vi.fn>;

function page(result: unknown[], pageNum: number, totalPages: number) {
  return { json: async () => ({ success: true, result, result_info: { page: pageNum, per_page: 50, total_pages: totalPages } }) };
}

beforeEach(() => fetchMock.mockReset());

describe('Cloudflare pagination', () => {
  it('fetches every page of zones', async () => {
    fetchMock.mockImplementation((url: string) => {
      const p = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? '1');
      return Promise.resolve(
        p === 1
          ? page([{ id: 'z1', name: 'a.com', status: 'active' }], 1, 2)
          : page([{ id: 'z2', name: 'b.com', status: 'active' }], 2, 2),
      );
    });

    const zones = await listCloudflareZones('token');
    expect(zones.map((z) => z.id)).toEqual(['z1', 'z2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after the last page (single page)', async () => {
    fetchMock.mockResolvedValue(page([{ id: 'r1', type: 'A', name: 'x', content: '1.1.1.1', ttl: 1, proxied: false, zone_id: 'z', zone_name: 'a' }], 1, 1));
    const records = await listCloudflareRecords('token', 'z1');
    expect(records).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requests all record types (no type= filter that drops TXT/MX)', async () => {
    fetchMock.mockResolvedValue(page([], 1, 1));
    await listCloudflareRecords('token', 'z1');
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('type=');
  });
});
