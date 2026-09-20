import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
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
  define: { "import.meta.env.VITE_APP_BUILD": JSON.stringify(buildId) },
  plugins: [
    react(),
    (() => {
      let output = "dist";
      let origin = "";
      return {
        name: "production-security-headers",
        apply: "build" as const,
        configResolved(config: ResolvedConfig) {
          output = resolve(config.root, config.build.outDir);
          const value = config.env.VITE_SUPABASE_URL;
          origin = value ? new URL(value).origin : "";
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
          const policy = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ${origin} ${origin.replace("https:", "wss:")}; img-src 'self' data:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
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
