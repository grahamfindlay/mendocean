import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_WEEK_PERIODS,
  weekPeriodsSchema,
  type WeekPeriod,
} from "../shared/weekPeriods";
import { api } from "./client";
const KEY = "mendocean-week-periods-v2";
function localPeriods() {
  try {
    const saved =
      localStorage.getItem(KEY) ??
      localStorage.getItem("mendocean-week-periods-v1");
    return saved
      ? weekPeriodsSchema.parse(JSON.parse(saved))
      : DEFAULT_WEEK_PERIODS;
  } catch {
    return DEFAULT_WEEK_PERIODS;
  }
}
/** Mount with a user-specific key so account changes never reuse another user's choices. */
export function useWeekPeriods(userId?: string, authReady = true) {
  const [periods, setPeriods] = useState<WeekPeriod[]>(() =>
    !authReady || userId ? [] : localPeriods(),
  );
  const [loading, setLoading] = useState(!authReady || !!userId);
  const [ready, setReady] = useState(authReady && !userId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{
    attempt: number;
    promise: Promise<WeekPeriod[]>;
  } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!authReady || !userId) return;
    let active = true;
    setLoading(true);
    setError("");
    // Reuse the request when development StrictMode replays this effect.
    // Retries create a new request; account changes remount the whole provider.
    if (!request.current || request.current.attempt !== attempt) {
      request.current = {
        attempt,
        promise: api<{ periods: WeekPeriod[] }>(
          "week-periods/v2",
          undefined,
          userId,
        ).then((data) => weekPeriodsSchema.parse(data.periods)),
      };
    }
    request.current.promise
      .then((parsed) => {
        if (active) {
          setPeriods(parsed);
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Could not load your saved forecast periods. Please try again.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, authReady, attempt]);
  async function save(next: WeekPeriod[]) {
    if (!mounted.current || busy.current || !ready) return false;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const parsed = weekPeriodsSchema.parse(next);
      if (userId) await api("week-periods/v2", { periods: parsed }, userId);
      else localStorage.setItem(KEY, JSON.stringify(parsed));
      if (!mounted.current) return false;
      setPeriods(parsed);
      return true;
    } catch {
      if (mounted.current)
        setError(
          "Could not save your periods. Your previous choices are unchanged. Please try again.",
        );
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return {
    periods,
    loading,
    ready,
    saving,
    error,
    save,
    retry: () => setAttempt((n) => n + 1),
  };
}
