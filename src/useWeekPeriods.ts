import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_WEEK_PERIODS,
  weekPeriodsSchema,
  type WeekPeriod,
} from "../shared/weekPeriods";
import { api } from "./client";
const KEY = "mendocean-week-periods-v1";
function localPeriods() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved
      ? weekPeriodsSchema.parse(JSON.parse(saved))
      : DEFAULT_WEEK_PERIODS;
  } catch {
    return DEFAULT_WEEK_PERIODS;
  }
}
/** Mount with a user-specific key so account changes never reuse another user's choices. */
export function useWeekPeriods(userId?: string) {
  const [periods, setPeriods] = useState<WeekPeriod[]>(() =>
    userId ? DEFAULT_WEEK_PERIODS : localPeriods(),
  );
  const [loading, setLoading] = useState(!!userId);
  const [ready, setReady] = useState(!userId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    setError("");
    api<{ periods: WeekPeriod[] }>("week-periods", undefined, userId)
      .then((data) => {
        const parsed = weekPeriodsSchema.parse(data.periods);
        if (active) {
          setPeriods(parsed);
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          setError("Could not load your saved periods. Retry to edit them.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, attempt]);
  async function save(next: WeekPeriod[]) {
    if (busy.current || !ready) return false;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const parsed = weekPeriodsSchema.parse(next);
      if (userId) await api("week-periods", { periods: parsed }, userId);
      else localStorage.setItem(KEY, JSON.stringify(parsed));
      setPeriods(parsed);
      return true;
    } catch {
      setError(
        "Could not save your periods. Your previous choices are unchanged. Please try again.",
      );
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
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
