/**
 * 1.2: Retry/backoff for provider HTTP calls.
 * withRetry retries N times with exponential backoff + jitter.
 * fetchWithRetry wraps fetchWithTimeout with retry on 429/5xx and network errors.
 * Does NOT retry 4xx (except 429).
 */
import { describe, it, expect, vi } from 'vitest';

process.env.NODE_ENV = 'test';

const { withRetry } = await import('../src/lib/retry');

describe('withRetry', () => {
  it('retries on failure and succeeds', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return 'ok';
    });

    const result = await withRetry(fn, { retries: 3, baseMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting retries', async () => {
    const fn = vi.fn(async () => { throw new Error('permanent'); });

    await expect(withRetry(fn, { retries: 2, baseMs: 1 })).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom retryOn', async () => {
    const fn = vi.fn(async () => { throw new Error('nope'); });
    const retryOn = vi.fn(() => false);

    await expect(withRetry(fn, { retries: 3, baseMs: 1, retryOn })).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(retryOn).toHaveBeenCalledWith(expect.any(Error), 0);
  });

  it('does not retry on the last attempt', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      throw new Error(`fail-${attempts}`);
    });

    await expect(withRetry(fn, { retries: 2, baseMs: 1 })).rejects.toThrow('fail-3');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on Response with 503 status', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        const err = new Response('Service Unavailable', { status: 503 });
        throw err;
      }
      return 'recovered';
    });

    const result = await withRetry(fn, {
      retries: 3,
      baseMs: 1,
      retryOn: (err) => err instanceof Response && [429, 500, 502, 503, 504].includes(err.status),
    });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on Response with 400 status', async () => {
    const fn = vi.fn(async () => {
      throw new Response('Bad Request', { status: 400 });
    });

    await expect(withRetry(fn, {
      retries: 3,
      baseMs: 1,
      retryOn: (err) => err instanceof Response && [429, 500, 502, 503, 504].includes(err.status),
    })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on network TypeError', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) throw new TypeError('fetch failed');
      return 'ok';
    });

    const result = await withRetry(fn, { retries: 3, baseMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
