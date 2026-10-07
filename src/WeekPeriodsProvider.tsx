import { createContext, useContext, type ReactNode } from "react";
import { useWeekPeriods } from "./useWeekPeriods";

const WeekPeriodsContext = createContext<ReturnType<
  typeof useWeekPeriods
> | null>(null);

/** App owns this provider and keys it by authentication state and account. */
export function WeekPeriodsProvider({
  userId,
  authReady,
  children,
}: {
  userId?: string;
  authReady: boolean;
  children: ReactNode;
}) {
  const preferences = useWeekPeriods(userId, authReady);
  return (
    <WeekPeriodsContext.Provider value={preferences}>
      {children}
    </WeekPeriodsContext.Provider>
  );
}

export function useWeekPeriodPreferences() {
  const preferences = useContext(WeekPeriodsContext);
  if (!preferences)
    throw new Error("Week periods require an account provider.");
  return preferences;
}
