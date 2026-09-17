import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("retains a foreground request arriving while an older check settles", async () => {
  vi.stubEnv("DEV", false);
  vi.stubGlobal("document", { getElementById: () => null });
  const updates = await import("../src/appUpdates");
  const applied = vi.fn();
  function worker(build: string) {
    return {
      postMessage(data: { type: string }, ports: MessagePort[]) {
        if (data.type === "GET_VERSION") ports[0].postMessage({ build });
        if (data.type === "APPLY_UPDATE") {
          applied(build);
          // Another tab refuses activation; this page must remain usable.
          ports[0].postMessage({ ok: false });
        }
      },
    };
  }
  let finish!: () => void;
  const active = worker(updates.APP_BUILD);
  const registration = {
    active,
    waiting: null as ReturnType<typeof worker> | null,
    installing: null,
    addEventListener() {},
    update: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async () => {
        registration.waiting = worker("next-release");
      }),
  };
  vi.stubGlobal("navigator", {
    onLine: true,
    serviceWorker: { register: async () => registration, controller: active },
  });
  const initial = updates.checkForUpdates(true);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  void updates.checkForUpdates(false, true);
  finish();
  await initial;
  await vi.waitFor(() => expect(applied).toHaveBeenCalledWith("next-release"));
  await vi.waitFor(() =>
    expect(updates.updateSnapshot()).toMatchObject({
      status: "ready",
      available: "next-release",
      message:
        "Finish or close forms in other Mendocean windows, then try again.",
    }),
  );
});
