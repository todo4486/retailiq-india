import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Status } from "./types";

interface StatusValue {
  status: Status | null;
  offline: string | null;
  refresh: () => void;
  /** Increments after every completed ETL run, so pages can refetch their data. */
  dataVersion: number;
}

const StatusContext = createContext<StatusValue>({ status: null, offline: null, refresh: () => {}, dataVersion: 0 });

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const refresh = useCallback(() => {
    api.status()
      .then((next) => {
        setStatus((previous) => {
          if (previous && previous.last_sync !== next.last_sync) setDataVersion((v) => v + 1);
          return next;
        });
        setOffline(null);
      })
      .catch((error: Error) => setOffline(error.message));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, status?.etl_running ? 2000 : 15000);
    return () => clearInterval(timer);
  }, [refresh, status?.etl_running]);

  return <StatusContext.Provider value={{ status, offline, refresh, dataVersion }}>{children}</StatusContext.Provider>;
}

export const useStatus = () => useContext(StatusContext);
