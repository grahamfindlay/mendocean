import { getTimes } from "suncalc";
import { LOCATION, chicagoToISO, localDateTime } from "../shared/domain";
import { dayBounds } from "../shared/timeline";

export interface DaylightPeriod {
  day: string;
  sunrise: number;
  sunset: number;
}

/** Solar times for each Madison calendar day touched by the chart's domain. */
export function daylightPeriods(start: number, end: number): DaylightPeriod[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return [];
  const periods: DaylightPeriod[] = [];
  let time = start;
  while (time < end) {
    const day = localDateTime(new Date(time).toISOString()).slice(0, 10);
    // Local noon selects this solar day regardless of the device timezone or DST.
    const times = getTimes(
      new Date(chicagoToISO(day + "T12:00")),
      LOCATION.latitude,
      LOCATION.longitude,
    );
    const sunrise = times.sunrise?.getTime() ?? NaN;
    const sunset = times.sunset?.getTime() ?? NaN;
    if (Number.isFinite(sunrise) && Number.isFinite(sunset) && sunset > sunrise)
      periods.push({ day, sunrise, sunset });
    time = dayBounds(day)[1];
  }
  return periods;
}
