import { useCallback, useEffect, useRef, useState } from "react";

// Runs an async loader whenever its dependencies change, ignoring out-of-date responses.
// The previous data stays visible during a reload, so charts do not flash empty.
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<(Error & { code?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const reload = useCallback(() => {
    const ticket = ++latest.current;
    setLoading(true);
    return loader()
      .then((value) => {
        if (ticket === latest.current) {
          setData(value);
          setError(null);
        }
      })
      .catch((reason: Error) => {
        if (ticket === latest.current) setError(reason);
      })
      .finally(() => {
        if (ticket === latest.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
