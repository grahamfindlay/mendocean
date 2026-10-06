import { APP_BUILD } from "./appUpdates";
import type { PostHog } from "posthog-js";

export const EVENTS = [
  "app_opened",
  "view_opened",
  "sign_in_completed",
  "report_started",
  "report_queued",
  "report_upload_failed",
  "report_save_confirmed",
  "bhc_connection_changed",
  "reminder_preferences_changed",
] as const;
export type EventName = (typeof EVENTS)[number];
const screens = [
  "Today",
  "Week",
  "Rows",
  "My rows",
  "History",
  "Log",
  "Account",
];
type Properties = Record<string, unknown>;
interface Sink {
  capture: (name: string, props: Properties) => unknown;
  identify: (id: string) => unknown;
  reset: () => unknown;
  captureException: (error: Error, props: Properties) => unknown;
}
let sink: Sink | undefined;
let actor: string | null = null;
let screen = "Today";
let lastVisit = 0;
let initialized = false;
let lastView = "";
const emitted = new Set<string>();
const bundleURL =
  /^(?:https:\/\/mendocean\.fyi|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)\/assets\/[\w.-]+\.js$/;
export function safeProperties(input: Properties): Properties {
  const out: Properties = {};
  if (input.schema_version === 1) out.schema_version = 1;
  if (typeof input.build === "string" && /^[\w.-]{1,120}$/.test(input.build))
    out.build = input.build;
  if (screens.includes(String(input.screen))) out.screen = input.screen;
  for (const name of ["online", "signed_in"])
    if (typeof input[name] === "boolean") out[name] = input[name];
  for (const name of ["request_id", "$insert_id"])
    if (
      typeof input[name] === "string" &&
      /^[a-f\d-]{36}$/i.test(input[name] as string)
    )
      out[name] = input[name];
  if (
    ["offline", "conflict", "auth", "server", "network", "other"].includes(
      String(input.category),
    )
  )
    out.category = input.category;
  if (["connect", "disconnect"].includes(String(input.action)))
    out.action = input.action;
  if (
    ["render", "uncaught", "promise", "api", "auth", "upload"].includes(
      String(input.operation),
    )
  )
    out.operation = input.operation;
  return out;
}
export function safeError(error: unknown, operation: string): Error {
  const result = new Error(
    `Unexpected ${["render", "uncaught", "promise", "api", "auth", "upload"].includes(operation) ? operation : "app"} failure`,
  );
  // Preserve only app bundle frame locations for symbolication, never raw messages/URLs.
  const frames =
    error instanceof Error
      ? (error.stack || "")
          .split("\n")
          .flatMap((line) => {
            const match = line.match(
              /(?:https:\/\/mendocean\.fyi|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)\/assets\/[\w.-]+\.js:\d+:\d+/,
            );
            return match ? [`    at ${match[0]}`] : [];
          })
          .slice(0, 20)
      : [];
  result.stack = `Error: ${result.message}\n${frames.join("\n")}`;
  return result;
}
export function filterEvent(
  event: {
    event: string;
    properties?: Properties;
    uuid?: string;
    timestamp?: unknown;
  } | null,
  projectToken = import.meta.env.VITE_POSTHOG_TOKEN,
) {
  if (
    !event ||
    ![...EVENTS, "$identify", "$exception"].includes(event.event as EventName)
  )
    return null;
  const original = event.properties || {};
  const properties = safeProperties(original);
  properties.$geoip_disable = true;
  // The ingest token is public project configuration, not an application credential.
  // Preserve only that exact token; generic caller-supplied token properties are dropped.
  if (projectToken && original.token === projectToken)
    properties.token = projectToken;
  // SDK identifiers and exception structures are generated from our sanitized Error.
  for (const key of [
    "distinct_id",
    "$device_id",
    "$anon_distinct_id",
    "$session_id",
    "$window_id",
  ]) {
    const value = original[key];
    if (typeof value === "string" && /^[a-f\d-]{36}$/i.test(value))
      properties[key] = value;
  }
  if (
    original.$process_person_profile === true ||
    original.$process_person_profile === false
  )
    properties.$process_person_profile = original.$process_person_profile;
  if (event.event === "$exception") {
    // Do not accept exceptions originating from SDK autocapture or remote settings.
    if (!original.mendocean_sanitized) return null;
    const exceptions = Array.isArray(original.$exception_list)
      ? original.$exception_list
      : [];
    properties.$exception_list = exceptions.slice(0, 1).map((exception) => {
      const frames = Array.isArray(exception?.stacktrace?.frames)
        ? exception.stacktrace.frames
        : [];
      return {
        type: "Error",
        value: safeError(null, String(properties.operation)).message,
        mechanism: {
          type: "generic",
          handled: !["uncaught", "promise"].includes(
            String(properties.operation),
          ),
        },
        stacktrace: {
          type: "raw",
          frames: frames
            .filter(
              (f: Properties) =>
                typeof f.filename === "string" && bundleURL.test(f.filename),
            )
            .slice(0, 20)
            .map((f: Properties) => ({
              platform: "web:javascript",
              // Required by PostHog's frame parser; never retain raw function names.
              function: "?",
              in_app: true,
              filename: f.filename,
              ...(Number.isSafeInteger(f.lineno) && Number(f.lineno) > 0
                ? { lineno: f.lineno }
                : {}),
              ...(Number.isSafeInteger(f.colno) && Number(f.colno) >= 0
                ? { colno: f.colno }
                : {}),
              ...(typeof f.chunk_id === "string" &&
              /^[\w-]{1,100}$/.test(f.chunk_id)
                ? { chunk_id: f.chunk_id }
                : {}),
            })),
        },
      };
    });
    properties.$exception_level = "error";
    if (
      typeof original.$release_id === "string" &&
      /^[\w.-]{1,120}$/.test(original.$release_id)
    )
      properties.$release_id = original.$release_id;
  }
  return {
    event: event.event,
    properties,
    ...(typeof event.uuid === "string" && /^[a-f\d-]{36}$/i.test(event.uuid)
      ? { uuid: event.uuid }
      : {}),
    ...(event.timestamp instanceof Date ||
    (typeof event.timestamp === "string" &&
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(event.timestamp) &&
      Number.isFinite(Date.parse(event.timestamp)))
      ? { timestamp: event.timestamp }
      : {}),
  };
}
export function setTelemetrySink(next?: Sink) {
  sink = next;
}
export function telemetryActor(next: string | null) {
  if (next === actor) return;
  try {
    sink?.reset();
    if (next) sink?.identify(next);
  } catch {
    sink = undefined; /* Fail closed if identity cannot be reset. */
  }
  actor = next;
  lastView = "";
}
export function track(
  name: EventName,
  properties: Properties = {},
  expectedActor: string | null = actor,
  once?: string,
) {
  if (!sink || expectedActor !== actor || (once && emitted.has(once))) return;
  if (once && name === "report_save_confirmed") {
    try {
      const key = "mendocean-observed-confirmations";
      const stored = JSON.parse(localStorage.getItem(key) || "[]");
      const seen = Array.isArray(stored)
        ? stored.filter(
            (v) =>
              typeof v === "string" &&
              /^confirmed:[a-f\d-]{36}:[a-f\d-]{36}$/i.test(v),
          )
        : [];
      if (seen.includes(once)) return;
      localStorage.setItem(key, JSON.stringify([...seen, once].slice(-1000)));
    } catch {
      /* Storage denial does not affect report delivery. */
    }
  }
  if (once) {
    emitted.add(once);
    if (emitted.size > 1000) emitted.delete(emitted.values().next().value!);
  }
  try {
    sink?.capture(
      name,
      safeProperties({
        schema_version: 1,
        build: APP_BUILD,
        screen,
        online: typeof navigator !== "undefined" && navigator.onLine,
        signed_in: !!actor,
        ...properties,
      }),
    );
  } catch {
    /* optional */
  }
}
export function telemetryView(next: string) {
  if (!screens.includes(next)) return;
  screen = next;
  const key = `${actor}:${next}`;
  if (lastView !== key) {
    lastView = key;
    track("view_opened");
  }
}
export function telemetryVisit(now = Date.now()) {
  if (!lastVisit || now - lastVisit >= 30 * 60000) track("app_opened");
  lastVisit = now;
}
export function captureFailure(
  error: unknown,
  operation: string,
  requestId?: string,
  expectedActor: string | null = actor,
) {
  if (
    expectedActor !== actor ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  )
    return;
  try {
    sink?.captureException(safeError(error, operation), {
      ...safeProperties({
        build: APP_BUILD,
        screen,
        signed_in: !!actor,
        operation,
        request_id: requestId,
      }),
      mendocean_sanitized: true,
    });
  } catch {
    /* optional */
  }
}
export async function initializeTelemetry() {
  if (initialized) return;
  initialized = true;
  if (
    !import.meta.env.PROD ||
    import.meta.env.VITE_TELEMETRY_ENABLED !== "true" ||
    !import.meta.env.VITE_POSTHOG_TOKEN
  )
    return;
  try {
    // Dynamic SDK loading can land after DOMContentLoaded but before window.load.
    // Wait for complete so the SDK's request dispatcher cannot miss its DOM-ready hook.
    if (document.readyState !== "complete")
      await new Promise<void>((resolve) =>
        window.addEventListener("load", () => resolve(), { once: true }),
      );
    const host =
      import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
    if (
      !["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(host)
    )
      return;
    const posthog = (await import("posthog-js/no-external")).default as PostHog;
    posthog.init(import.meta.env.VITE_POSTHOG_TOKEN, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      capture_performance: false,
      person_profiles: "identified_only",
      save_campaign_params: false,
      save_referrer: false,
      advanced_disable_feature_flags: true,
      persistence: "localStorage",
      before_send: (event) => filterEvent(event) as typeof event,
      ip: false,
      loaded: (instance) => {
        // Persisted SDK identity may belong to a prior signed-out/account-switched visit.
        sink = instance;
        try {
          instance.reset();
          if (actor) instance.identify(actor);
        } catch {
          sink = undefined;
          return;
        }
        lastVisit = 0;
        telemetryVisit();
        lastView = "";
        telemetryView(screen);
      },
    });
    window.addEventListener("error", (e) => {
      if (e.error) captureFailure(e.error, "uncaught");
    });
    window.addEventListener("unhandledrejection", (e) =>
      captureFailure(e.reason, "promise"),
    );
  } catch {
    /* SDK availability never gates the app */
  }
}
