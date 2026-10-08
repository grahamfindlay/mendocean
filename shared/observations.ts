/** Measured conditions only. Forecasts never enter these records. */
export const OBSERVATION_SOURCES = ["buoy", "iem_msn", "vc_jmp"] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];
export interface Observation {
  source: ObservationSource;
  observed_at: string;
  wind: number | null;
  gust: number | null;
  direction: number | null;
  temperature: number | null;
  stations: string[];
  flags: string[];
  definition: string;
}
export interface ObservationSummary extends Observation {
  start: string;
  end: string;
  sample_count: number;
  expected_count: number | null;
  wind_min: number | null;
  wind_max: number | null;
  received_at: string;
  raw_paths: string[];
}
export const SOURCE_LABELS: Record<ObservationSource, string> = {
  buoy: "Mendota buoy",
  iem_msn: "MSN airport · IEM",
  vc_jmp: "James Madison Park · Visual Crossing",
};
const numeric = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const multiply = (v: unknown, factor: number) =>
  numeric(v) === null ? null : Number(v) * factor;
const timestamp = (v: unknown) => {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
    throw new Error("Invalid observation time");
  return new Date(v).toISOString();
};
function quality(r: Observation): Observation {
  if (r.wind !== null && r.wind < 0) r.flags.push("negative_wind");
  if (r.gust !== null && r.gust < 0) r.flags.push("negative_gust");
  if (r.wind !== null && r.gust !== null && r.gust < r.wind)
    r.flags.push("gust_below_wind");
  if (r.direction !== null && (r.direction < 0 || r.direction > 360))
    r.flags.push("invalid_direction");
  if (r.gust === null) r.flags.push("gust_missing");
  return r;
}
export function parseBuoy(data: any): Observation[] {
  if (
    data?.code !== 200 ||
    !Array.isArray(data.results?.timestamps) ||
    !Array.isArray(data.results?.symbols) ||
    !Array.isArray(data.results?.data)
  )
    throw new Error("Invalid buoy response");
  const { timestamps, symbols, data: values } = data.results;
  if (timestamps.length !== values.length) throw new Error("Invalid buoy rows");
  for (const required of [
    "run_wind_speed",
    "gust",
    "wind_direction",
    "air_temp",
  ]) {
    if (!symbols.some((s: string) => s.split(".").at(-1) === required))
      throw new Error("Missing buoy field");
  }
  return timestamps.map((time: string, i: number) => {
    if (!Array.isArray(values[i]) || values[i].length !== symbols.length)
      throw new Error("Invalid buoy row");
    const v: Record<string, unknown> = Object.fromEntries(
      symbols.map((s: string, j: number) => [
        s.split(".").at(-1),
        values[i][j],
      ]),
    );
    return quality({
      source: "buoy",
      observed_at: timestamp(time),
      wind: multiply(v.run_wind_speed, 2.2369362920544),
      gust: multiply(v.gust, 2.2369362920544),
      direction: numeric(v.wind_direction),
      temperature:
        numeric(v.air_temp) === null ? null : Number(v.air_temp) * 1.8 + 32,
      stations: ["mendota.buoy"],
      flags: [],
      definition:
        "Wind: trailing 2-minute mean; gust: trailing 2-minute maximum; direction: instantaneous. Converted from m/s and °C to mph and °F.",
    });
  });
}
export function parseIEM(data: any): Observation[] {
  const records = data?.last_ob ? [data.last_ob] : data?.data;
  if (!Array.isArray(records)) throw new Error("Invalid IEM response");
  return records.map((v: any) => {
    const metar = String(v.raw || v.metar || "");
    if (v.station && !["MSN", "KMSN"].includes(v.station))
      throw new Error("Unexpected IEM station");
    const match = metar.match(/(?:^|\s)(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT/);
    const precision = metar.match(/\bT([01])(\d{3})([01])(\d{3})\b/);
    let temperature = numeric(v["airtemp[F]"] ?? v.tmpf);
    const flags: string[] = [];
    if (temperature === null && precision) {
      temperature =
        (Number(precision[2]) / 10) * (precision[1] === "1" ? -1 : 1) * 1.8 +
        32;
      flags.push("temperature_derived_from_metar");
    }
    return quality({
      source: "iem_msn",
      observed_at: timestamp(v.utc_valid),
      wind: multiply(v["windspeed[kt]"] ?? v.sknt, 1.1507794480235425),
      gust: multiply(
        numeric(v.gust) ?? (match?.[3] ? Number(match[3]) : null),
        1.1507794480235425,
      ),
      direction: numeric(v["winddirection[deg]"] ?? v.drct),
      temperature,
      stations: ["KMSN"],
      flags,
      definition: `ASOS/METAR report (${metar.includes("MADISHF") ? "MADISHF_5min" : "METAR"}); original report preserved in raw archive; wind converted from knots to mph.`,
    });
  });
}
export function parseVC(data: any): Observation[] {
  const v = data?.currentConditions;
  if (
    !v ||
    !Number.isFinite(v.datetimeEpoch) ||
    !Array.isArray(v.stations) ||
    !v.stations.length ||
    v.source !== "obs"
  )
    throw new Error("VC did not return station observations");
  return [
    quality({
      source: "vc_jmp",
      observed_at: new Date(v.datetimeEpoch * 1000).toISOString(),
      wind: numeric(v.windspeed),
      gust: numeric(v.windgust),
      direction: numeric(v.winddir),
      temperature: numeric(v.temp),
      stations: v.stations,
      flags: [],
      definition:
        "VC default station selection at James Madison Park; provider averaging unspecified; requested US units (mph, °F).",
    }),
  ];
}
const mean = (values: (number | null)[]) => {
  const numbers = values.filter((v): v is number => v !== null);
  return numbers.length
    ? numbers.reduce((a, b) => a + b, 0) / numbers.length
    : null;
};
export function circularMean(rows: Pick<Observation, "direction" | "wind">[]) {
  const valid = rows.filter(
    (r) =>
      r.direction !== null &&
      r.direction >= 0 &&
      r.direction <= 360 &&
      r.wind !== null &&
      r.wind >= 1,
  );
  if (!valid.length) return null;
  const x = mean(valid.map((r) => Math.cos((r.direction! * Math.PI) / 180)))!;
  const y = mean(valid.map((r) => Math.sin((r.direction! * Math.PI) / 180)))!;
  return Math.hypot(x, y) < 1e-6
    ? null
    : ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
/** Only completed UTC bins. Repeated times aren't additional independent samples. */
export function summarizeObservations(
  rows: Observation[],
  received: string,
  paths: string[],
): ObservationSummary[] {
  const unique = new Map<string, Observation>();
  for (const row of rows) {
    if (Date.parse(row.observed_at) > Date.parse(received)) continue;
    const key = `${row.source}:${row.observed_at}`;
    const prior = unique.get(key);
    const score = (r: Observation) =>
      [r.wind, r.gust, r.direction, r.temperature].filter((v) => v !== null)
        .length;
    if (!prior || score(row) >= score(prior)) unique.set(key, row);
  }
  const groups = new Map<string, Observation[]>();
  for (const row of unique.values()) {
    const start = Math.floor(Date.parse(row.observed_at) / 300000) * 300000;
    if (start + 300000 > Date.parse(received)) continue;
    const key = `${row.source}:${start}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.values()]
    .map((group) => {
      group.sort((a, b) => a.observed_at.localeCompare(b.observed_at));
      const last = group.at(-1)!;
      const start = Math.floor(Date.parse(last.observed_at) / 300000) * 300000;
      const wind = group
        .map((r) => r.wind)
        .filter((v): v is number => v !== null && v >= 0);
      const gust = group
        .map((r) => r.gust)
        .filter((v): v is number => v !== null && v >= 0);
      const expected =
        last.source === "buoy" ? 5 : last.source === "iem_msn" ? 1 : null;
      const flags = [...new Set(group.flatMap((r) => r.flags))];
      if (expected !== null && group.length < expected)
        flags.push("incomplete_samples");
      if (last.source !== "buoy")
        flags.push("point_reports_not_full_interval_average");
      return {
        ...last,
        start: new Date(start).toISOString(),
        end: new Date(start + 300000).toISOString(),
        wind: mean(wind),
        wind_min: wind.length ? Math.min(...wind) : null,
        wind_max: wind.length ? Math.max(...wind) : null,
        gust: gust.length ? Math.max(...gust) : null,
        direction: circularMean(group),
        temperature: mean(group.map((r) => r.temperature)),
        sample_count: group.length,
        expected_count: expected,
        received_at: received,
        raw_paths: paths,
        stations: [...new Set(group.flatMap((r) => r.stations))],
        flags,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}
export function outingMeasurements(
  rows: ObservationSummary[],
  start: string,
  end: string,
) {
  const a = Date.parse(start),
    b = Date.parse(end);
  return OBSERVATION_SOURCES.map((source) => {
    const selected = rows.filter(
      (r) =>
        r.source === source && Date.parse(r.end) > a && Date.parse(r.start) < b,
    );
    const values = (key: "wind" | "temperature") =>
      selected
        .filter((r) => r[key] !== null)
        .map((r) => ({
          value: r[key]!,
          weight: Math.max(
            0,
            Math.min(b, Date.parse(r.end)) - Math.max(a, Date.parse(r.start)),
          ),
        }));
    const weighted = (key: "wind" | "temperature") => {
      const v = values(key),
        weight = v.reduce((n, r) => n + r.weight, 0);
      return weight
        ? v.reduce((n, r) => n + r.value * r.weight, 0) / weight
        : null;
    };
    const gusts = selected
      .map((r) => r.gust)
      .filter((v): v is number => v !== null);
    return {
      source,
      label: SOURCE_LABELS[source],
      wind: weighted("wind"),
      gust: gusts.length ? Math.max(...gusts) : null,
      direction: circularMean(selected),
      temperature: weighted("temperature"),
      bins: selected.length,
      expected_bins: Math.ceil(b / 300000) - Math.floor(a / 300000),
      sample_count: selected.reduce((n, r) => n + r.sample_count, 0),
      latest_observed_at:
        selected
          .map((r) => r.observed_at)
          .sort()
          .at(-1) || null,
      received_at:
        selected
          .map((r) => r.received_at)
          .sort()
          .at(-1) || null,
      max_delivery_delay_minutes: selected.length
        ? Math.max(
            ...selected.map(
              (r) =>
                (Date.parse(r.received_at) - Date.parse(r.observed_at)) / 60000,
            ),
          )
        : null,
      stations: [...new Set(selected.flatMap((r) => r.stations))],
      raw_paths: [...new Set(selected.flatMap((r) => r.raw_paths))],
      flags: [...new Set(selected.flatMap((r) => r.flags))],
      definitions: [...new Set(selected.map((r) => r.definition))],
    };
  });
}
