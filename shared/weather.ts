import {
  HEURISTIC_VERSION,
  LOCATION,
  type Forecast,
  type WeatherHour,
} from "./domain.ts";
export function weatherURL(): string {
  const q = new URLSearchParams({
    latitude: String(LOCATION.latitude),
    longitude: String(LOCATION.longitude),
    hourly:
      "temperature_2m,precipitation_probability,precipitation,weather_code,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    current:
      "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "UTC",
    timeformat: "unixtime",
    forecast_days: "7",
    past_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}
export function normalizeWeather(
  raw: any,
  fetchedAt = new Date().toISOString(),
): Forecast {
  if (!Array.isArray(raw.hourly?.time))
    throw new Error("Weather provider returned no hourly forecast.");
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const row = (h: any, i?: number): WeatherHour => {
    const v = (key: string) => (i === undefined ? h[key] : h[key]?.[i]);
    return {
      time: new Date(v("time") * 1000).toISOString(),
      wind: n(v("wind_speed_10m")),
      direction: n(v("wind_direction_10m")),
      gust: n(v("wind_gusts_10m")),
      temperature: n(v("temperature_2m")),
      precipitation: n(v("precipitation")),
      probability: n(v("precipitation_probability")),
      visibility: n(v("visibility")),
      code: n(v("weather_code")),
    };
  };
  return {
    fetched_at: fetchedAt,
    provider: "Open-Meteo",
    model_version: HEURISTIC_VERSION,
    hours: raw.hourly.time.map((_: number, i: number) => row(raw.hourly, i)),
    current: raw.current ? row(raw.current) : null,
    source_kind: "modeled",
  };
}
