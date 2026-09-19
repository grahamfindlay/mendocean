import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function harness() {
  const posted: string[] = [];
  const build = (id: string) => ({
    postMessage(data: { type: string }, ports?: MessagePort[]) {
      posted.push(data.type);
      if (data.type === "GET_VERSION") ports?.[0].postMessage({ build: id });
    },
  });
  const listeners: Record<string, (() => void)[]> = {};
  const reload = vi.fn();
  vi.stubEnv("DEV", false);
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("location", { reload });
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("setInterval", () => 0);
  return { posted, build, listeners, reload };
}

it("applies a waiting release at a launch boundary, reloading only once it takes control", async () => {
  const { posted, build, listeners, reload } = harness();
  const updates = await import("../src/appUpdates");
  const active = build(updates.APP_BUILD);
  const registration = {
    active,
    waiting: build("next-release"),
    installing: null,
    addEventListener() {},
    update: vi.fn(async () => {}),
  };
  vi.stubGlobal("navigator", {
    onLine: true,
    serviceWorker: {
      register: async () => registration,
      controller: active,
      addEventListener(type: string, fn: () => void) {
        (listeners[type] ||= []).push(fn);
      },
      removeEventListener() {},
    },
  });
  const stop = updates.startAppUpdates(() => {});
  // No window is polled first: the release is applied on its own.
  await vi.waitFor(() => expect(posted).toContain("SKIP_WAITING"));
  expect(posted).not.toContain("APPLY_UPDATE");
  expect(updates.updateSnapshot()).toMatchObject({ status: "applying" });
  expect(reload).not.toHaveBeenCalled();
  listeners.controllerchange.forEach((fn) => fn());
  expect(reload).toHaveBeenCalledTimes(1);
  listeners.controllerchange.forEach((fn) => fn());
  expect(reload).toHaveBeenCalledTimes(1);
  stop();
});

it("a manual check offers a release without applying it", async () => {
  const { posted, build, listeners } = harness();
  const updates = await import("../src/appUpdates");
  const active = build(updates.APP_BUILD);
  const registration = {
    active,
    waiting: build("next-release"),
    installing: null,
    addEventListener() {},
    update: vi.fn(async () => {}),
  };
  vi.stubGlobal("navigator", {
    onLine: true,
    serviceWorker: {
      register: async () => registration,
      controller: active,
      addEventListener(type: string, fn: () => void) {
        (listeners[type] ||= []).push(fn);
      },
      removeEventListener() {},
    },
  });
  await updates.checkForUpdates(true);
  expect(updates.updateSnapshot()).toMatchObject({
    status: "ready",
    available: "next-release",
    message: "Update available.",
  });
  expect(posted).not.toContain("SKIP_WAITING");
});
