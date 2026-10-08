import { liveProviders, type Providers } from "./providers.ts";
import { normalizeWeather, weatherURL } from "../../../shared/weather.ts";
import {
  LOCATION,
  type Forecast,
  type WeatherHour,
} from "../../../shared/domain.ts";
import { check, query, service } from "./runtime.ts";
export class WeatherCollectionError extends Error {
  constructor(public stage: string) {
    super(`Weather collection failed: ${stage}`);
  }
}
export async function collectWeather(providers: Providers = liveProviders) {
  let stage = "read_latest";
  try {
    const db = service();
    const last = check(
      await db
        .from("weather_runs")
        .select("fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    if (last && providers.now() - Date.parse(last.fetched_at) < 14 * 60000)
      return;
    stage = "fetch_provider";
    const requestedAt = new Date(providers.now()).toISOString();
    const response = await providers.fetch(weatherURL(), {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new WeatherCollectionError(`provider_http_${response.status}`);
    stage = "normalize";
    const raw = await response.json();
    const forecast = normalizeWeather(
      raw,
      new Date(providers.now()).toISOString(),
    );
    const id = crypto.randomUUID();
    const path = forecast.fetched_at.slice(0, 10) + "/" + id + ".json.gz";
    stage = "compress";
    const gzip = await new Response(
      new Blob([
        JSON.stringify({
          schema_version: 2,
          forecast,
          raw,
          request: weatherURL(),
          requested_at: requestedAt,
          units: { wind: "mph", temperature: "F" },
        }),
      ])
        .stream()
        .pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    stage = "archive_upload";
    check(
      await db.storage
        .from("weather-archive")
        .upload(path, gzip, { contentType: "application/gzip", upsert: false }),
    );
    stage = "save_summary";
    check(
      await db.from("weather_runs").insert({
        id,
        fetched_at: forecast.fetched_at,
        provider: forecast.provider,
        object_path: path,
        summary: forecast,
      }),
    );
    // Keep the hot database small; immutable complete runs remain in private object storage.
    stage = "prune_hot_cache";
    const old = check(
      await db
        .from("weather_runs")
        .select("id,summary")
        .lt("fetched_at", new Date(Date.now() - 2 * 86400000).toISOString())
        .not("summary", "eq", "{}")
        .limit(100),
    );
    for (const run of old || [])
      check(
        await db.from("weather_runs").update({ summary: {} }).eq("id", run.id),
      );
  } catch (error) {
    if (error instanceof WeatherCollectionError) throw error;
    throw new WeatherCollectionError(stage);
  }
}
export function weatherFeatures(hours: WeatherHour[], start: string) {
  const t = Date.parse(start);
  const row = hours.reduce<WeatherHour | null>(
    (best, h) =>
      Math.abs(Date.parse(h.time) - t) <
      Math.abs(Date.parse(best?.time || "1900-01-01") - t)
        ? h
        : best,
    null,
  );
  if (!row || Math.abs(Date.parse(row.time) - t) > 3600000) return null;
  const previous = hours.filter(
    (h) => Date.parse(h.time) >= t - 6 * 3600000 && Date.parse(h.time) <= t,
  );
  return {
    wind: row.wind,
    direction: row.direction,
    gust: row.gust,
    temperature: row.temperature,
    precipitation: row.precipitation,
    preceding: previous.map((h) => ({
      time: h.time,
      wind: h.wind,
      direction: h.direction,
      gust: h.gust,
    })),
  };
}
async function enrichInterval(
  id: string,
  providers: Providers,
  interval?: { start: string; end: string; report_id: string },
) {
  const db = service();
  const outing = check(
    await db.from("outings").select("*").eq("id", id).single(),
  );
  const effectiveStart =
    interval?.start || outing.actual_starts_at || outing.starts_at;
  const effectiveEnd = interval?.end || outing.actual_ends_at || outing.ends_at;
  const run = check(
    await db
      .from("weather_runs")
      .select("*")
      .lte("fetched_at", effectiveStart)
      .gte(
        "fetched_at",
        new Date(Date.parse(effectiveStart) - 6 * 3600000).toISOString(),
      )
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  let forecast: Forecast | null = null;
  let kind = "historical_reanalysis";
  if (run) {
    kind = "archived_forecast";
    if (run.summary?.hours) forecast = run.summary;
    else {
      const file = check(
        await db.storage.from("weather-archive").download(run.object_path),
      );
      if (!file) throw new Error("Archive unavailable");
      const archived = await new Response(
        file.stream().pipeThrough(new DecompressionStream("gzip")),
      ).json();
      forecast = archived.forecast || archived;
    }
  }
  if (!forecast) {
    const start = new Date(Date.parse(effectiveStart) - 86400000)
      .toISOString()
      .slice(0, 10);
    const end = effectiveEnd.slice(0, 10);
    const url = new URL(
      "https://historical-forecast-api.open-meteo.com/v1/forecast",
    );
    const common = new URL(weatherURL()).searchParams;
    for (const [k, v] of common)
      if (
        ![
          "current",
          "forecast_days",
          "past_days",
          "minutely_15",
          "forecast_minutely_15",
          "past_minutely_15",
        ].includes(k)
      )
        url.searchParams.set(k, v);
    url.searchParams.set("start_date", start);
    url.searchParams.set("end_date", end);
    const response = await providers.fetch(url, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("Historical weather not yet available");
    forecast = normalizeWeather(
      await response.json(),
      new Date(providers.now()).toISOString(),
    );
    kind = "historical_forecast";
  }
  const features = weatherFeatures(forecast.hours, effectiveStart);
  if (!features) throw new Error("Weather missing for outing time");
  const args = {
    outing_id: id,
    run_id: run?.id || null,
    source_kind: kind,
    features: {
      ...features,
      forecast_received_at: forecast.fetched_at,
      forecast_age_minutes_at_start: run
        ? (Date.parse(effectiveStart) - Date.parse(forecast.fetched_at)) / 60000
        : null,
      forecast_convention: run
        ? "latest archived forecast collected before outing start (within six hours)"
        : "historical forecast retrieved after the event; advance availability unverified",
      latitude: LOCATION.latitude,
      longitude: LOCATION.longitude,
    },
  };
  if (interval) {
    check(
      await db.rpc("observation_query", {
        action: "report_forecast_put",
        args: {
          ...args,
          report_id: interval.report_id,
          start: effectiveStart,
          end: effectiveEnd,
        },
      }),
    );
  } else await query("features_put", args);
}
export async function enrichOuting(
  id: string,
  providers: Providers = liveProviders,
) {
  await enrichInterval(id, providers);
  const db = service();
  const outing = check(
    await db.from("outings").select("*").eq("id", id).single(),
  );
  const reports = check(
    await db.from("reports").select("id,data").eq("outing_id", id),
  );
  for (const report of reports || [])
    await enrichInterval(id, providers, {
      report_id: report.id,
      start:
        outing.actual_starts_at || report.data.actual_start || outing.starts_at,
      end: outing.actual_ends_at || report.data.actual_end || outing.ends_at,
    });
}
