import { withRetry } from './retry';

/** fetch with a hard timeout — external APIs must never hang a sync or login forever. */
export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export interface FetchWithRetryOptions {
  timeoutMs?: number;
  retries?: number;
  baseMs?: number;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * fetchWithTimeout + retry on transient HTTP errors (429, 5xx), timeouts, and
 * network failures.  Does NOT retry 4xx (except 429).  Respects Retry-After.
 *
 * On the *last* attempt a retryable HTTP response is returned (not thrown) so
 * the caller can inspect status/headers.  All earlier retryable errors are
 * thrown so that withRetry performs the next attempt.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts?: FetchWithRetryOptions,
): Promise<Response> {
  const retries = opts?.retries ?? 3;

  try {
    return await withRetry(
      async () => {
        const res = await fetchWithTimeout(url, init, opts?.timeoutMs);

        if (!res.ok && RETRYABLE_STATUSES.has(res.status)) {
          throw res; // withRetry will catch, backoff, and retry
        }

        return res;
      },
      {
        retries,
        baseMs: opts?.baseMs ?? 1_000,
        retryOn: (err) => {
          if (err instanceof Response) {
            return RETRYABLE_STATUSES.has(err.status);
          }
          if (err instanceof DOMException) {
            return err.name === 'TimeoutError' || err.name === 'AbortError';
          }
          if (err instanceof TypeError) return true;
          return false;
        },
      },
    );
  } catch (err) {
    // withRetry throws the last error after exhausting retries.
    // If it's a retryable HTTP response, return it so the caller can inspect it.
    if (err instanceof Response && RETRYABLE_STATUSES.has(err.status)) {
      return err;
    }
    throw err;
  }
}
