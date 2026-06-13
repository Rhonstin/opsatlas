/**
 * 1.4: Exchange-rates stores lastAttemptAt separately from fetchedAt.
 * On fallback, fetchedAt is NOT overwritten — the real age of the rate is preserved.
 * Retries are rate-limited: no more than once per hour based on lastAttemptAt.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test_secret';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef';

import db from '../src/db';

// Mock fetchWithTimeout before importing exchange-rates
const mockFetch = vi.fn();
vi.mock('../src/lib/http', () => ({ fetchWithTimeout: (...args: unknown[]) => mockFetch(...args) }));

// We need to import after mocking
const mod = await import('../src/lib/exchange-rates');
const { getRate, convert } = mod;

// The in-memory CACHE in exchange-rates.ts persists across tests — clear it
// by re-importing won't work (module cache). Instead, we reset by calling
// getRate with a never-used pair to avoid stale hits, or we accept that
// tests in different describe blocks share state and adjust accordingly.
// Simplest: use unique currency pairs per describe block.

beforeEach(async () => {
  await db.migrate.latest();
  await db('app_settings').whereLike('key', 'fx_rate:%').delete();
  mockFetch.mockReset();
});

describe('exchange-rates fallback', () => {
  const PAIR_FROM = 'CHF';
  const PAIR_TO = 'GBP';

  it('preserves fetchedAt on fallback and updates lastAttemptAt', async () => {
    const realFetchedAt = Date.now() - 5 * 3_600_000;
    await db('app_settings').insert({
      key: `fx_rate:${PAIR_FROM}:${PAIR_TO}`,
      value: JSON.stringify({ rate: 1.25, fetchedAt: realFetchedAt, lastAttemptAt: realFetchedAt }),
    });

    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const rate = await getRate(PAIR_FROM, PAIR_TO);
    expect(rate).toBe(1.25);

    const row = await db('app_settings').where({ key: `fx_rate:${PAIR_FROM}:${PAIR_TO}` }).first();
    const parsed = JSON.parse(row.value);
    expect(parsed.fetchedAt).toBe(realFetchedAt);
    expect(parsed.lastAttemptAt).toBeGreaterThan(realFetchedAt);
  });

  it('skips API retry if lastAttemptAt is recent (< 1h)', async () => {
    const recentAttempt = Date.now() - 30 * 60_000;
    const realFetchedAt = Date.now() - 10 * 3_600_000;
    await db('app_settings').insert({
      key: `fx_rate:${PAIR_FROM}:${PAIR_TO}`,
      value: JSON.stringify({ rate: 1.25, fetchedAt: realFetchedAt, lastAttemptAt: recentAttempt }),
    });

    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ rates: { [PAIR_TO]: 1.30 } }) });

    const rate = await getRate(PAIR_FROM, PAIR_TO);
    expect(rate).toBe(1.25);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('exchange-rates successful fetch', () => {
  const PAIR_FROM = 'SEK';
  const PAIR_TO = 'NOK';

  it('fetches fresh rate from API and persists it', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rates: { [PAIR_TO]: 0.95 } }),
    });

    const rate = await getRate(PAIR_FROM, PAIR_TO);
    expect(rate).toBe(0.95);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const row = await db('app_settings').where({ key: `fx_rate:${PAIR_FROM}:${PAIR_TO}` }).first();
    expect(row).toBeDefined();
    const parsed = JSON.parse(row.value);
    expect(parsed.rate).toBe(0.95);
  });

  it('returns 1 for identical currencies without API call', async () => {
    const rate = await getRate('DKK', 'DKK');
    expect(rate).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when no persisted rate and API fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(getRate('PLN', 'CZK')).rejects.toThrow('unavailable');
  });
});

describe('convert', () => {
  it('multiplies and rounds to 6 decimal places', () => {
    expect(convert(10, 1.1)).toBeCloseTo(11, 5);
    expect(convert(0.01, 1.1)).toBeCloseTo(0.011, 5);
  });

  it('handles zero amount', () => {
    expect(convert(0, 1.5)).toBe(0);
  });
});

describe('exchange-rates fallback', () => {
  it('preserves fetchedAt on fallback and updates lastAttemptAt', async () => {
    // Seed a persisted rate with a known fetchedAt
    const realFetchedAt = Date.now() - 5 * 3_600_000; // 5 hours ago
    await db('app_settings').insert({
      key: 'fx_rate:EUR:USD',
      value: JSON.stringify({ rate: 1.08, fetchedAt: realFetchedAt, lastAttemptAt: realFetchedAt }),
    });

    // API always fails
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const rate = await getRate('EUR', 'USD');
    expect(rate).toBe(1.08);

    // Verify persisted: fetchedAt unchanged, lastAttemptAt updated
    const row = await db('app_settings').where({ key: 'fx_rate:EUR:USD' }).first();
    const parsed = JSON.parse(row.value);
    expect(parsed.fetchedAt).toBe(realFetchedAt); // NOT overwritten
    expect(parsed.lastAttemptAt).toBeGreaterThan(realFetchedAt); // updated to now
  });

  it('skips API retry if lastAttemptAt is recent (< 1h)', async () => {
    const recentAttempt = Date.now() - 30 * 60_000; // 30 min ago
    const realFetchedAt = Date.now() - 10 * 3_600_000;
    await db('app_settings').insert({
      key: 'fx_rate:EUR:USD',
      value: JSON.stringify({ rate: 1.08, fetchedAt: realFetchedAt, lastAttemptAt: recentAttempt }),
    });

    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ rates: { USD: 1.10 } }) });

    const rate = await getRate('EUR', 'USD');
    expect(rate).toBe(1.08); // used cached, did NOT call API

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
