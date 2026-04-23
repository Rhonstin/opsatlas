import { useState, useMemo } from 'react';

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

function getValue(obj: Record<string, unknown>, key: string): unknown {
  return obj[key] ?? null;
}

function compare(a: unknown, b: unknown, dir: SortDir): number {
  // Nulls always last
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  let result: number;
  if (typeof a === 'number' && typeof b === 'number') {
    result = a - b;
  } else if (typeof a === 'string' && typeof b === 'string') {
    result = a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  } else {
    result = String(a).localeCompare(String(b));
  }
  return dir === 'asc' ? result : -result;
}

export function useSort<T extends Record<string, unknown>, K extends string>(
  data: T[],
  defaultKey: K,
  defaultDir: SortDir = 'asc',
) {
  const [sort, setSort] = useState<SortState<K>>({ key: defaultKey, dir: defaultDir });

  function toggle(key: K) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  }

  const sorted = useMemo(
    () => [...data].sort((a, b) => compare(getValue(a, sort.key), getValue(b, sort.key), sort.dir)),
    [data, sort],
  );

  function indicator(key: K): string {
    if (sort.key !== key) return ' ↕';
    return sort.dir === 'asc' ? ' ↑' : ' ↓';
  }

  return { sorted, sort, toggle, indicator };
}
