/**
 * Exchange rate helper using the Frankfurter API (api.frankfurter.app).
 * Free, no API key required. Rates from the European Central Bank, updated daily.
 *
 * Fail-closed: when the API is down, the last known rate from app_settings is
 * used (with a staleness warning). If no rate was ever fetched, getRate throws —
 * recording no costs is better than recording costs converted at a wrong rate.
 */
import db from '../db';
import { fetchWithTimeout } from './http';
import { logger } from './logger';

const log = logger.child({ module: 'exchange-rates' });

interface CacheEntry { rate: number; fetchedAt: number; lastAttemptAt?: number }
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const RETRY_MIN_MS = 60 * 60 * 1000; // don't retry API more than once per hour
const FETCH_TIMEOUT_MS = 10_000;

function settingsKey(from: string, to: string): string {
  return `fx_rate:${from}:${to}`;
}

async function loadPersistedRate(from: string, to: string): Promise<CacheEntry | null> {
  const row = await db('app_settings')
    .where({ key: settingsKey(from, to) })
    .first()
    .catch(() => null);
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as CacheEntry;
    if (typeof parsed.rate !== 'number' || parsed.rate <= 0) return null;
    // Migrate old entries that lack lastAttemptAt
    if (parsed.lastAttemptAt == null) parsed.lastAttemptAt = parsed.fetchedAt;
    return parsed;
  } catch {
    return null;
  }
}

async function persistRate(from: string, to: string, entry: CacheEntry): Promise<void> {
  await db('app_settings')
    .insert({ key: settingsKey(from, to), value: JSON.stringify(entry) })
    .onConflict('key')
    .merge(['value'])
    .catch((err: unknown) => {
      log.warn({ from, to, err }, 'failed to persist rate');
    });
}

/**
 * Get the exchange rate from `from` to `to`.
 * Returns 1 for identical currencies. Throws if no rate is available at all.
 */
export async function getRate(from: string, to: string): Promise<number> {
  const fromU = from.toUpperCase();
  const toU   = to.toUpperCase();
  if (fromU === toU) return 1;

  const key    = `${fromU}→${toU}`;
  const now    = Date.now();
  const cached = CACHE.get(key);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.rate;

  // If we recently attempted the API (within RETRY_MIN_MS) and it failed,
  // skip the fetch and go straight to the persisted fallback.
  const persisted = await loadPersistedRate(fromU, toU);
  if (persisted && persisted.lastAttemptAt && now - persisted.lastAttemptAt < RETRY_MIN_MS) {
    const ageHours = Math.round((now - persisted.fetchedAt) / 3_600_000);
    log.info({ from: fromU, to: toU, rate: persisted.rate, ageHours, lastAttemptMin: Math.round((now - persisted.lastAttemptAt!) / 60_000) }, 'using cached rate');
    return persisted.rate;
  }

  try {
    const res = await fetchWithTimeout(
      `https://api.frankfurter.dev/v1/latest?from=${fromU}&to=${toU}`,
      {},
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { rates: Record<string, number> };
    const rate = data.rates[toU];
    if (!rate) throw new Error(`${toU} not in response`);

    const entry: CacheEntry = { rate, fetchedAt: now, lastAttemptAt: now };
    CACHE.set(key, entry);
    await persistRate(fromU, toU, entry);
    log.info({ from: fromU, to: toU, rate }, 'fetched fresh rate');
    return rate;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);

    if (persisted) {
      const ageHours = Math.round((now - persisted.fetchedAt) / 3_600_000);
      log.warn({ from: fromU, to: toU, err: reason, rate: persisted.rate, ageHours }, 'fetch failed, using persisted rate');
      // Update lastAttemptAt only — fetchedAt stays as the real age of the rate
      const updated: CacheEntry = { ...persisted, lastAttemptAt: now };
      CACHE.set(key, updated);
      await persistRate(fromU, toU, updated);
      return persisted.rate;
    }

    throw new Error(`Exchange rate ${fromU}→${toU} unavailable: ${reason}`);
  }
}

/** Convenience: apply a rate to a numeric cost, round to 6 decimal places. */
export function convert(amount: number, rate: number): number {
  return Math.round(amount * rate * 1_000_000) / 1_000_000;
}
