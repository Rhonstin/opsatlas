/**
 * Exchange rate helper using the Frankfurter API (api.frankfurter.app).
 * Free, no API key required. Rates from the European Central Bank, updated daily.
 */

interface CacheEntry { rate: number; fetchedAt: number }
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 h

/**
 * Get the exchange rate from `from` to `to`.
 * Returns 1 if currencies are identical or if the API fails (fail-open).
 */
export async function getRate(from: string, to: string): Promise<number> {
  const fromU = from.toUpperCase();
  const toU   = to.toUpperCase();
  if (fromU === toU) return 1;

  const key    = `${fromU}→${toU}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.rate;

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${fromU}&to=${toU}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { rates: Record<string, number> };
    const rate = data.rates[toU];
    if (!rate) throw new Error(`${toU} not in response`);

    CACHE.set(key, { rate, fetchedAt: Date.now() });
    console.log(`[exchange-rates] 1 ${fromU} = ${rate} ${toU}`);
    return rate;
  } catch (err: unknown) {
    console.warn(`[exchange-rates] ${fromU}→${toU} failed: ${err instanceof Error ? err.message : err}. Using 1.`);
    return 1;
  }
}

/** Convenience: apply a rate to a numeric cost, round to 6 decimal places. */
export function convert(amount: number, rate: number): number {
  return Math.round(amount * rate * 1_000_000) / 1_000_000;
}
