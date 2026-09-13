import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});
it("does not upload one account’s offline report using another account’s session", async () => {
  vi.stubGlobal("location", new URL("http://localhost/"));
  vi.stubGlobal("fetch", vi.fn());
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "fixture-public-key");
  vi.doMock("@supabase/supabase-js", () => ({
    createClient: () => ({
      auth: {
        getSession: async () => ({
          data: {
            session: { user: { id: "bob" }, access_token: "fixture-session" },
          },
        }),
      },
    }),
  }));
  const { api } = await import("../src/client");
  await expect(
    api("report", { private: "alice-report" }, "alice"),
  ).rejects.toThrow("Sign back into the account");
  expect(fetch).not.toHaveBeenCalled();
});
