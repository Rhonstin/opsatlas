'use client';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a `poll(check, opts)` function that calls `check` every `intervalMs`
 * until it resolves `true` (done). All timers are cleared on unmount, so a
 * navigation away can never leak an interval.
 *
 * `check` should handle its own errors and return `true` to stop polling.
 * Pass `timeoutMs` to cap a poll; `onTimeout` fires if the cap is hit first.
 */
export function usePollUntil(intervalMs = 2000) {
  const timers = useRef<Set<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const t of active) clearInterval(t as ReturnType<typeof setInterval>);
      active.clear();
    };
  }, []);

  return useCallback(
    (check: () => Promise<boolean>, opts?: { timeoutMs?: number; onTimeout?: () => void }) => {
      const interval = setInterval(async () => {
        const done = await check().catch(() => true);
        if (done) {
          clearInterval(interval);
          timers.current.delete(interval);
          if (timeout) { clearTimeout(timeout); timers.current.delete(timeout); }
        }
      }, intervalMs);
      timers.current.add(interval);

      const timeout = opts?.timeoutMs
        ? setTimeout(() => {
            clearInterval(interval);
            timers.current.delete(interval);
            opts.onTimeout?.();
          }, opts.timeoutMs)
        : undefined;
      if (timeout) timers.current.add(timeout);
    },
    [intervalMs],
  );
}
