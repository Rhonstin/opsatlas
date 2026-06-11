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

interface CacheEntry { rate: number; fetchedAt: number }
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 h
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
    return typeof parsed.rate === 'number' && parsed.rate > 0 ? parsed : null;
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
      console.warn(`[exchange-rates] failed to persist ${from}→${to}:`, err instanceof Error ? err.message : err);
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
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.rate;

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

    const entry = { rate, fetchedAt: Date.now() };
    CACHE.set(key, entry);
    await persistRate(fromU, toU, entry);
    console.log(`[exchange-rates] 1 ${fromU} = ${rate} ${toU}`);
    return rate;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);

    const persisted = await loadPersistedRate(fromU, toU);
    if (persisted) {
      const ageHours = Math.round((Date.now() - persisted.fetchedAt) / 3_600_000);
      console.warn(`[exchange-rates] ${fromU}→${toU} fetch failed (${reason}); using persisted rate ${persisted.rate} (${ageHours}h old)`);
      CACHE.set(key, { ...persisted, fetchedAt: Date.now() - TTL_MS + 60 * 60 * 1000 }); // retry API in ~1h
      return persisted.rate;
    }

    throw new Error(`Exchange rate ${fromU}→${toU} unavailable: ${reason}`);
  }
}

/** Convenience: apply a rate to a numeric cost, round to 6 decimal places. */
export function convert(amount: number, rate: number): number {
  return Math.round(amount * rate * 1_000_000) / 1_000_000;
}
