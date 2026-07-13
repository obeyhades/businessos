'use client';

import { useEffect, useState } from 'react';

/** Returns a debounced copy of `value` that only updates after `delay` ms of quiet. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}
