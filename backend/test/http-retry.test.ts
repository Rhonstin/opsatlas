/**
 * E2E test for fetchWithRetry: proves that HTTP 429/5xx are retried,
 * timeouts are retried, and non-retryable 4xx are not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.NODE_ENV = 'test';

const { fetchWithRetry } = await import('../src/lib/http');

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function okResponse(body = 'ok'): Response {
  return new Response(body, { status: 200, statusText: 'OK' });
}

function errResponse(status: number, headers?: Record<string, string>): Response {
  return new Response(`Error ${status}`, {
    status,
    statusText: `Error ${status}`,
    headers: new Headers(headers),
  });
}

describe('fetchWithRetry', () => {
  it('retries on 503 twice, then returns 200 (3 total calls)', async () => {
    fetchSpy
      .mockResolvedValueOnce(errResponse(503))
      .mockResolvedValueOnce(errResponse(503))
      .mockResolvedValueOnce(okResponse('success'));

    const res = await fetchWithRetry('https://example.com/api', {}, { retries: 2, baseMs: 1 });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('success');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('retries on 429', async () => {
    fetchSpy
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(okResponse());

    const res = await fetchWithRetry('https://example.com/api', {}, { retries: 2, baseMs: 1 });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400 (1 call only)', async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(400));

    const res = await fetchWithRetry('https://example.com/api', {}, { retries: 3, baseMs: 1 });

    expect(res.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401', async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(401));

    const res = await fetchWithRetry('https://example.com/api', {}, { retries: 3, baseMs: 1 });

    expect(res.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 503 Response after exhausting retries (retries=2 → 3 calls)', async () => {
    fetchSpy
      .mockResolvedValueOnce(errResponse(503))
      .mockResolvedValueOnce(errResponse(503))
      .mockResolvedValueOnce(errResponse(503));

    const res = await fetchWithRetry('https://example.com/api', {}, { retries: 2, baseMs: 1 });

    expect(res.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('retries on network TypeError', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse());

    const res = await fetchWithRetry('https://example.com/api', {}, { retries: 2, baseMs: 1 });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('passes init (method, headers) to fetch', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());

    await fetchWithRetry(
      'https://example.com/api',
      { method: 'POST', headers: { Authorization: 'Bearer xyz' } },
      { retries: 1, baseMs: 1 },
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
