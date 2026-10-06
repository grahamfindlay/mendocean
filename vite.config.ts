import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { defineConfig, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import { normalizeWeather, weatherURL } from "./shared/weather.ts";
const commit =
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.VITE_BUILD_SHA ||
  "local";
const buildId =
  process.env.MENDOCEAN_BUILD_ID || commit + "-" + randomUUID().slice(0, 8);
export default defineConfig({
  build: { sourcemap: "hidden" },
  define: { "import.meta.env.VITE_APP_BUILD": JSON.stringify(buildId) },
  plugins: [
    react(),
    (() => {
      let output = "dist";
      let origin = "";
      let analyticsOrigin = "";
      let telemetryEnabled = false;
      return {
        name: "production-security-headers",
        apply: "build" as const,
        configResolved(config: ResolvedConfig) {
          output = resolve(config.root, config.build.outDir);
          const value = config.env.VITE_SUPABASE_URL;
          origin = value ? new URL(value).origin : "";
          telemetryEnabled = config.env.VITE_TELEMETRY_ENABLED === "true";
          const analytics =
            config.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
          if (telemetryEnabled) {
            if (
              ![
                "https://us.i.posthog.com",
                "https://eu.i.posthog.com",
              ].includes(analytics) ||
              !config.env.VITE_POSTHOG_TOKEN
            )
              throw new Error(
                "Telemetry requires a PostHog token and supported ingest host.",
              );
            analyticsOrigin = analytics;
          }
        },
        transformIndexHtml() {
          return [
            {
              tag: "meta",
              attrs: { name: "mendocean-build", content: buildId },
              injectTo: "head" as const,
            },
          ];
        },
        closeBundle() {
          // Injection changes JS. Complete it BEFORE computing precache hashes.
          if (
            telemetryEnabled ||
            process.env.POSTHOG_SOURCEMAPS_UPLOAD === "true"
          ) {
            if (
              !process.env.POSTHOG_CLI_API_KEY ||
              !process.env.POSTHOG_CLI_PROJECT_ID
            )
              throw new Error(
                "Telemetry builds require scoped PostHog source-map credentials.",
              );
            if (
              process.env.POSTHOG_CLI_DRY_RUN === "true" &&
              process.env.TEST_STACK !== "local-only"
            )
              throw new Error(
                "Source-map dry runs are restricted to the isolated test harness.",
              );
            const uploadHost =
              process.env.POSTHOG_CLI_HOST ||
              (analyticsOrigin.includes("eu.")
                ? "https://eu.posthog.com"
                : "https://us.posthog.com");
            if (
              !["https://us.posthog.com", "https://eu.posthog.com"].includes(
                uploadHost,
              ) ||
              (telemetryEnabled &&
                uploadHost.includes("eu.") !== analyticsOrigin.includes("eu."))
            )
              throw new Error(
                "Source-map upload host must match the PostHog ingest region.",
              );
            try {
              execFileSync(
                resolve("node_modules/.bin/posthog-cli"),
                [
                  "--host",
                  uploadHost,
                  "sourcemap",
                  "process",
                  "--directory",
                  resolve(output, "assets"),
                  "--release-name",
                  "mendocean",
                  "--release-version",
                  buildId,
                  "--delete-after",
                ],
                { timeout: 120000, stdio: "pipe" },
              );
            } catch {
              throw new Error(
                "PostHog source-map processing failed; deployment was stopped before generating release hashes.",
              );
            }
          }
          for (const file of readdirSync(resolve(output, "assets"), {
            recursive: true,
          })) {
            if (String(file).endsWith(".map"))
              unlinkSync(resolve(output, "assets", String(file)));
          }
          writeFileSync(
            resolve(output, "build.json"),
            JSON.stringify({
              commit,
              build: buildId,
            }),
          );
          const files = [
            "index.html",
            "manifest.webmanifest",
            "icon.svg",
            "logo.svg",
            "icon-180.png",
            "icon-192.png",
            "icon-512.png",
            ...readdirSync(resolve(output, "assets"), { recursive: true })
              .filter(
                (f) =>
                  !String(f).endsWith(".map") &&
                  statSync(resolve(output, "assets", String(f))).isFile(),
              )
              .map((f) => "assets/" + String(f)),
          ];
          const release = {
            id: buildId,
            commit,
            created: Date.now(),
            assets: files.map((file) => ({
              url: file === "index.html" ? "/" : "/" + file,
              type: file.endsWith(".html")
                ? "text/html"
                : file.endsWith(".js")
                  ? "javascript"
                  : file.endsWith(".css")
                    ? "text/css"
                    : null,
              hash: createHash("sha256")
                .update(readFileSync(resolve(output, file)))
                .digest("hex"),
            })),
          };
          const swPath = resolve(output, "sw.js");
          writeFileSync(
            swPath,
            readFileSync(swPath, "utf8").replace(
              "__MENDOCEAN_RELEASE__",
              JSON.stringify(release),
            ),
          );
          const path = resolve(output, "_headers");
          const headers = readFileSync(path, "utf8");
          const policy = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ${origin} ${origin.replace("https:", "wss:")} ${analyticsOrigin}; img-src 'self' data: blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
          writeFileSync(
            path,
            headers + "\n/*\n  Content-Security-Policy: " + policy + "\n",
          );
        },
      };
    })(),
    {
      name: "local-weather-preview",
      configureServer(server) {
        let cached: unknown;
        let expires = 0;
        server.middlewares.use("/api/weather", async (_req, res) => {
          try {
            if (!cached || Date.now() > expires) {
              const response = await fetch(weatherURL(), {
                signal: AbortSignal.timeout(15000),
              });
              if (!response.ok) throw new Error("Weather provider unavailable");
              cached = normalizeWeather(await response.json());
              expires = Date.now() + 900000;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(cached));
          } catch {
            res.statusCode = 503;
            res.end(
              JSON.stringify({
                error: "Weather is temporarily unavailable. Try again shortly.",
              }),
            );
          }
        });
      },
    },
  ],
});
