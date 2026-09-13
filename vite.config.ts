import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import { normalizeWeather, weatherURL } from "./shared/weather.ts";
export default defineConfig({
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
        closeBundle() {
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
              expires = Date.now() + 1800000;
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
