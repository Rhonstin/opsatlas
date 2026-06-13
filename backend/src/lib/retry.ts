/**
 * Generic retry wrapper with exponential backoff and jitter.
 * Retries on transient network errors and specific HTTP status codes.
 */
export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  retryOn?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

function isRetryableHttpError(res: Response): boolean {
  return DEFAULT_RETRY_STATUS.has(res.status);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/**
 * Retry `fn` up to `retries` times with exponential backoff + jitter.
 * By default retries on network errors and HTTP 429/5xx.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const retries = opts?.retries ?? 3;
  const baseMs = opts?.baseMs ?? 1_000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      // If the caller provided a custom retryOn, consult it
      if (opts?.retryOn && !opts.retryOn(err, attempt)) {
        throw err;
      }

      // For Response errors, check status
      if (err instanceof Response && !isRetryableHttpError(err)) {
        throw err;
      }

      // Don't retry on the last attempt
      if (attempt === retries) break;

      // Compute delay: check Retry-After from Response, else exponential backoff + jitter
      let delayMs = baseMs * Math.pow(2, attempt) + Math.random() * baseMs;
      if (err instanceof Response) {
        const retryAfter = parseRetryAfter(err.headers.get('retry-after'));
        if (retryAfter != null) delayMs = Math.max(delayMs, retryAfter);
      }

      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}
