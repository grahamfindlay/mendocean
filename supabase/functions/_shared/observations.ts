import {
  OBSERVATION_SOURCES,
  parseBuoy,
  parseIEM,
  parseVC,
  summarizeObservations,
  outingMeasurements,
  type ObservationSource,
  type ObservationSummary,
} from "../../../shared/observations.ts";
import { localDateTime } from "../../../shared/domain.ts";
import { check, enqueue, service } from "./runtime.ts";
import { liveProviders, type Providers } from "./providers.ts";
import { WeatherCollectionError } from "./weather.ts";

export async function observationQuery(
  action: string,
  args: Record<string, unknown> = {},
) {
  return check(await service().rpc("observation_query", { action, args }));
}
export async function archiveEvidence(path: string, value: unknown) {
  const bytes = await new Response(
    new Blob([JSON.stringify(value)])
      .stream()
      .pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  check(
    await service()
      .storage.from("weather-archive")
      .upload(path, bytes, { contentType: "application/gzip", upsert: false }),
  );
}
export async function readEvidence(path: string) {
  const file = check(
    await service().storage.from("weather-archive").download(path),
  );
  if (!file) throw new Error("Weather archive unavailable");
  return new Response(
    file.stream().pipeThrough(new DecompressionStream("gzip")),
  ).json();
}
function requests(
  source: ObservationSource,
  now: number,
  backfillDay?: string,
) {
  const end = backfillDay
    ? Date.parse(backfillDay + "T00:00:00Z") + 86400000
    : now;
  const start = backfillDay ? end - 86400000 : now - 3600000;
  if (source === "buoy") {
    const url = new URL("https://metobs.ssec.wisc.edu/api/data.json");
    url.search = new URLSearchParams({
      site: "mendota",
      inst: "buoy",
      symbols: "air_temp:wind_speed:wind_direction:gust:run_wind_speed",
      begin: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      order: "row",
      interval: "1m",
    }).toString();
    return [url];
  }
  if (source === "iem_msn") {
    // IEM history is keyed by Madison's local day; a UTC backfill can cross two dates.
    const days = new Set([
      localDateTime(new Date(start).toISOString()).slice(0, 10),
      localDateTime(new Date(end - 1).toISOString()).slice(0, 10),
    ]);
    const urls = [...days].map(
      (date) =>
        new URL(
          "https://mesonet.agron.iastate.edu/api/1/obhistory.json?" +
            new URLSearchParams({
              station: "MSN",
              network: "WI_ASOS",
              date,
              full: "true",
            }),
        ),
    );
    if (!backfillDay)
      urls.unshift(
        new URL(
          "https://mesonet.agron.iastate.edu/json/current.py?station=MSN&network=WI_ASOS",
        ),
      );
    return urls;
  }
  const url = new URL(
    "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/43.0814,-89.3829",
  );
  url.search = new URLSearchParams({
    include: "current",
    unitGroup: "us",
    contentType: "json",
    key: Deno.env.get("VISUAL_CROSSING_API_KEY") || "",
  }).toString();
  return [url];
}
export async function collectObservations(
  source: ObservationSource,
  providers: Providers = liveProviders,
  backfillDay?: string,
) {
  if (!OBSERVATION_SOURCES.includes(source)) throw new Error("Invalid source");
  const now = providers.now(),
    slot = Math.floor(now / 900000),
    id = crypto.randomUUID();
  const at = new Date(now).toISOString();
  const reservation = await observationQuery("reserve", {
    source,
    slot,
    at,
    backfill: !!backfillDay,
  });
  if (!reservation.acquired) return;
  const path = `observations/${source}/${at.slice(0, 10)}/${id}.json.gz`;
  let stage = "fetch",
    archived = false;
  const evidence: any = {
    schema_version: 1,
    source,
    requested_at: at,
    backfill_day: backfillDay || null,
    units: { wind: "mph", temperature: "F" },
    responses: [],
  };
  try {
    const samples = [];
    const partialErrors: string[] = [];
    for (const url of requests(source, now, backfillDay)) {
      const safe = new URL(url);
      safe.searchParams.delete("key");
      stage = "fetch";
      try {
        const response = await providers.fetch(url, {
          signal: AbortSignal.timeout(15000),
        });
        // Parse only after preserving the provider response. Never archive authentication URLs/headers.
        let text = await response.text();
        const key = Deno.env.get("VISUAL_CROSSING_API_KEY");
        if (source === "vc_jmp" && key)
          text = text.replaceAll(key, "[redacted]");
        const received = new Date(providers.now()).toISOString();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        evidence.responses.push({
          endpoint: safe.href,
          received_at: received,
          http_status: response.status,
          data,
          ...(data === null ? { body: text.slice(0, 10000) } : {}),
        });
        if (!response.ok)
          throw new WeatherCollectionError(
            `observations_${source}_http_${response.status}`,
          );
        stage = "parse";
        samples.push(
          ...(source === "buoy"
            ? parseBuoy(data)
            : source === "iem_msn"
              ? parseIEM(data)
              : parseVC(data)),
        );
      } catch (error) {
        const code =
          error instanceof WeatherCollectionError
            ? error.stage
            : `observations_${source}_${stage}`;
        partialErrors.push(code);
        evidence.responses.push({ endpoint: safe.href, error: code });
      }
    }
    evidence.partial_errors = partialErrors;
    if (partialErrors.length && !samples.length)
      throw new WeatherCollectionError(partialErrors[0]);
    if (partialErrors.length)
      for (const sample of samples)
        sample.flags.push("partial_provider_failure");
    const received = new Date(providers.now()).toISOString();
    evidence.received_at = received;
    if (source === "vc_jmp" && evidence.responses[0]?.data?.queryCost > 1)
      throw new WeatherCollectionError("observations_vc_jmp_query_cost");
    const latest =
      samples
        .map((r) => r.observed_at)
        .filter((t) => Date.parse(t) <= providers.now())
        .sort()
        .at(-1) || null;
    // Keep empty valid responses as missing observations; freshness monitoring catches sustained gaps.
    const rows = summarizeObservations(samples, received, [path]);
    stage = "archive";
    await archiveEvidence(path, evidence);
    archived = true;
    stage = "commit";
    await observationQuery("commit", {
      id,
      source,
      slot,
      lease: reservation.lease,
      at: received,
      object_path: path,
      rows,
      latest_observed_at: latest,
      partial_error: partialErrors[0] || null,
      backfill: !!backfillDay,
    });
  } catch (error) {
    const code =
      error instanceof WeatherCollectionError
        ? error.stage
        : `observations_${source}_${stage}`;
    evidence.error = code;
    if (!archived) {
      try {
        await archiveEvidence(path, evidence);
        archived = true;
      } catch {
        /* DB error record still identifies the missing raw file. */
      }
    }
    await observationQuery("error", {
      id,
      source,
      lease: reservation.lease,
      at: new Date(providers.now()).toISOString(),
      error: code,
      object_path: archived ? path : null,
    });
    throw new WeatherCollectionError(code);
  }
}
export async function observationWindow(
  start: string,
  end: string,
): Promise<ObservationSummary[]> {
  const result = await observationQuery("window", { start, end });
  const rows: ObservationSummary[] = [];
  for (const path of result.bundles)
    rows.push(...(await readEvidence(path)).rows);
  rows.push(...result.rows);
  const unique = new Map(rows.map((r) => [`${r.source}:${r.start}`, r]));
  return [...unique.values()].filter(
    (r) =>
      Date.parse(r.end) > Date.parse(start) &&
      Date.parse(r.start) < Date.parse(end),
  );
}
export async function enrichMeasurements(
  id: string,
  providers: Providers = liveProviders,
) {
  const outing = check(
    await service().from("outings").select("*").eq("id", id).single(),
  );
  const start = outing.actual_starts_at || outing.starts_at,
    end = outing.actual_ends_at || outing.ends_at;
  const ended = Date.parse(end) <= providers.now();
  const rows = ended ? await observationWindow(start, end) : [];
  if (ended)
    await observationQuery("measurements_put", {
      outing_id: id,
      start,
      end,
      at: new Date(providers.now()).toISOString(),
      data: {
        start,
        end,
        sources: outingMeasurements(rows, start, end),
        interval_definition:
          "Five-minute summaries overlapping the outing; partial boundary bins include measurements outside the outing. Airport/VC entries summarize available point reports, not continuous interval coverage.",
        units: {
          wind: "mph",
          temperature: "F",
          direction: "degrees from north",
        },
      },
    });
  const reports = check(
    await service().from("reports").select("id,data").eq("outing_id", id),
  );
  for (const report of reports || []) {
    const a =
      outing.actual_starts_at || report.data.actual_start || outing.starts_at;
    const b = outing.actual_ends_at || report.data.actual_end || outing.ends_at;
    if (Date.parse(b) > providers.now()) continue;
    const rr = a === start && b === end ? rows : await observationWindow(a, b);
    await observationQuery("report_measurements_put", {
      report_id: report.id,
      start: a,
      end: b,
      at: new Date(providers.now()).toISOString(),
      data: {
        start: a,
        end: b,
        sources: outingMeasurements(rr, a, b),
        interval_definition:
          "Five-minute summaries overlapping your reported interval; boundary bins may extend outside the row.",
        units: {
          wind: "mph",
          temperature: "F",
          direction: "degrees from north",
        },
      },
    });
  }
}
export async function scheduleObservations(
  providers: Providers = liveProviders,
) {
  const now = new Date(providers.now()),
    slot = Math.floor(now.getTime() / 900000);
  const health = await observationQuery("health");
  for (const source of OBSERVATION_SOURCES) {
    if (source === "vc_jmp") {
      const state = health.sources.find((s: any) => s.source === source);
      if (!Deno.env.get("VISUAL_CROSSING_API_KEY") || state?.review_due)
        continue;
    }
    await enqueue(
      "observations",
      null,
      null,
      now,
      `observations:${source}:${slot}`,
      { source },
    );
  }
  // Backfill once daily after UTC midnight, even when no user opens the app.
  if (now.getUTCHours() === 1) {
    const day = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    for (const source of ["buoy", "iem_msn"])
      await enqueue(
        "observations_backfill",
        null,
        null,
        now,
        `observations:backfill:${source}:${day}`,
        { source, day },
      );
  }
  await enqueue(
    "observations_maintenance",
    null,
    null,
    now,
    `observations:maintenance:${now.toISOString().slice(0, 10)}:${now.getUTCHours()}`,
  );
}
export async function maintainObservations(
  providers: Providers = liveProviders,
) {
  const at = new Date(providers.now()).toISOString();
  const candidate = await observationQuery("archive_candidate", { at });
  if (candidate.day && candidate.rows.length) {
    const path = `observation-bundles/${candidate.day}/${crypto.randomUUID()}.json.gz`;
    await archiveEvidence(path, {
      schema_version: 1,
      day: candidate.day,
      rows: candidate.rows,
    });
    const verified = await readEvidence(path);
    if (JSON.stringify(verified.rows) !== JSON.stringify(candidate.rows))
      throw new Error("Observation archive verification failed");
    await observationQuery("archive_commit", {
      day: candidate.day,
      object_path: path,
      rows: candidate.rows,
    });
  }
  const candidates = await observationQuery("repair_candidates", { at });
  for (const outing of candidates)
    await enqueue(
      "observations_enrich",
      null,
      outing.id,
      new Date(providers.now()),
      `observations:enrich:${outing.id}:${Math.floor(providers.now() / 21600000)}`,
    );
  await observationQuery("cleanup", { at });
}
