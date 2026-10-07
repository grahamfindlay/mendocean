import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client";
import { formatDate, formatTime } from "../shared/domain";

export const adminStamp = (value: string | null) =>
  value ? `${formatDate(value)} ${formatTime(value)}` : "Not observed";

export interface AdminOuting {
  id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  actual_starts_at: string | null;
  actual_ends_at: string | null;
}
export interface AdminHealth {
  database_bytes: number;
  weather_storage_bytes: number;
  failed_jobs: number;
  last_weather: string | null;
  models: {
    id: string;
    created_at: string;
    status: string;
    metrics: unknown;
    eligible: boolean;
    current_revision: boolean;
  }[];
}

/** Ignore responses from an old page/filter, including during account changes. */
export function useAdminData<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [updated, setUpdated] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const value = await api<T>(path);
      if (request !== generation.current) return;
      setData(value);
      setUpdated(new Date().toISOString());
    } catch (e) {
      if (request === generation.current) setError((e as Error).message);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }, [path]);
  useEffect(() => {
    setData(undefined);
    setUpdated(null);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  return { data, setData, error, busy, updated, refresh };
}

export function useAdminAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, message, setMessage, run };
}

export function useAdminOutings() {
  const rows = useAdminData<AdminOuting[]>("admin/outings");
  const [more, setMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setMore(null);
    setOlderError("");
  }, [rows.updated]);
  const loadOlder = async () => {
    setLoadingOlder(true);
    setOlderError("");
    try {
      const older = await api<AdminOuting[]>(
        `admin/outings?offset=${rows.data?.length || 0}`,
      );
      if (!alive.current) return;
      rows.setData((previous = []) => [
        ...previous,
        ...older.filter((row) => !previous.some((p) => p.id === row.id)),
      ]);
      setMore(older.length === 200);
    } catch (e) {
      if (alive.current) setOlderError((e as Error).message);
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  };
  return {
    ...rows,
    error: rows.error || olderError,
    busy: rows.busy || loadingOlder,
    hasMore: more ?? rows.data?.length === 200,
    loadOlder,
  };
}
