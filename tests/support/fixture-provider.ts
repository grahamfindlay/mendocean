// Copied only into the disposable Supabase project, never deployed.
import type { Providers } from "./providers.ts";
const endpoint = Deno.env.get("FIXTURE_URL")!;
const headers = { "Content-Type": "application/json", "x-fixture-secret": Deno.env.get("FIXTURE_SECRET")! };
export const fixtureProviders: Providers = {
  now: () => Date.now(),
  fetch: async (input, init) => {
    const url = new URL(String(input));
    if (!["api.boathouseconnect.com", "api.open-meteo.com", "historical-forecast-api.open-meteo.com", "api.resend.com"].includes(url.hostname))
      throw new Error("Unexpected upstream destination");
    return await fetch(endpoint + "/upstream", { method: "POST", headers, body: JSON.stringify({ url: url.href, method: init?.method || "GET", body: init?.body, headers: init?.headers }) });
  },
  push: async (subscription, payload, options) => {
    const response = await fetch(endpoint + "/push", { method: "POST", headers, body: JSON.stringify({ subscription, payload, options }) });
    if (!response.ok) throw Object.assign(new Error("Fixture push rejected"), { statusCode: response.status });
    return {};
  },
};
