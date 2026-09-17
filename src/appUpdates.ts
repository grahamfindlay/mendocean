import {
  lockUpdate,
  unlockUpdate,
  updateBlockReason,
  prepareUpdate,
} from "./updateSafety";
export const APP_BUILD: string =
  import.meta.env.VITE_APP_BUILD || "development";
export type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "downloading"
    | "ready"
    | "applying"
    | "current"
    | "error";
  message: string;
  available?: string;
};
let state: UpdateState = { status: "idle", message: "" };
const listeners = new Set<() => void>();
const publish = (next: UpdateState) => {
  state = next;
  listeners.forEach((f) => f());
};
export const subscribeUpdates = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const updateSnapshot = () => state;
let registration: ServiceWorkerRegistration | undefined;
let checking: Promise<void> | undefined;
let applying = false,
  reloading = false,
  started = false,
  autoAtEntry = false;
let lastCheck = 0,
  intended = "";
let intendedWorker: ServiceWorker | null = null;
let beforeReload = () => {};
const seen = new WeakSet<ServiceWorker>();
function message<T>(
  worker: ServiceWorker,
  data: unknown,
  timeout = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("Update check timed out."));
    }, timeout);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(e.data);
    };
    worker.postMessage(data, [channel.port2]);
  });
}
async function workerBuild(worker: ServiceWorker) {
  return (await message<{ build: string }>(worker, { type: "GET_VERSION" }))
    .build;
}
async function offer(worker: ServiceWorker) {
  const build = await workerBuild(worker);
  if (build === APP_BUILD && worker !== registration?.waiting) {
    autoAtEntry = false;
    if (!navigator.serviceWorker.controller)
      worker.postMessage({ type: "CLAIM", build: APP_BUILD });
    worker.postMessage({ type: "CLEANUP" });
    if (state.status !== "ready")
      publish({ status: "current", message: "Up to date." });
    return;
  }
  publish({ status: "ready", available: build, message: "Update available." });
  if (autoAtEntry) {
    autoAtEntry = false;
    // Initial weather/account reads can still be settling at a foreground boundary.
    if (await prepareUpdate()) {
      await applyUpdate();
      if (!reloading && state.status !== "applying") unlockUpdate();
    }
  }
}
function observe(worker: ServiceWorker | null) {
  if (!worker || seen.has(worker)) return;
  seen.add(worker);
  publish({ status: "downloading", message: "Downloading update…" });
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed") {
      if (registration?.waiting) void offer(registration.waiting).catch(failed);
      else {
        autoAtEntry = false;
        publish({ status: "current", message: "Up to date." });
      }
    } else if (worker.state === "redundant")
      failed(
        new Error(
          "The complete update could not be downloaded. Your current app is still available.",
        ),
      );
  });
}
function failed(error: unknown) {
  autoAtEntry = false;
  publish({
    status: "error",
    message: navigator.onLine
      ? error instanceof Error
        ? error.message
        : "Unable to check for updates. Try again."
      : "Unable to check while offline. Your current app is still available.",
  });
}
async function reloadFor(build: string) {
  if (reloading || intended !== build) return;
  // Never reload before the intended worker actually controls the page.
  const controller = navigator.serviceWorker.controller;
  // Do not wake the outgoing worker while the browser is retiring it.
  if (!controller || controller !== intendedWorker) return;
  if (controller.state !== "activated") {
    controller.addEventListener(
      "statechange",
      () => {
        if (controller.state === "activated")
          void reloadFor(build).catch(failed);
      },
      { once: true },
    );
    return;
  }
  if (
    (await workerBuild(controller)) !== build ||
    reloading ||
    intended !== build
  )
    return;
  if (build === APP_BUILD) {
    intended = "";
    unlockUpdate();
    publish({ status: "current", message: "Up to date." });
    controller.postMessage({ type: "CLEANUP" });
    return;
  }
  // Recheck after asynchronous worker messaging, including a timed-out lock.
  if (!lockUpdate()) {
    publish({
      status: "ready",
      available: build,
      message: "Update available. Finish your current work before updating.",
    });
    return;
  }
  try {
    if (sessionStorage.getItem("mendocean-update-attempt") === build) {
      unlockUpdate();
      failed(
        new Error(
          "The update did not finish. Check for updates again when connected.",
        ),
      );
      return;
    }
    beforeReload();
    sessionStorage.setItem("mendocean-update-attempt", build);
  } catch {
    unlockUpdate();
    failed(
      new Error(
        "Unable to preserve your place. Close and reopen the app to finish updating.",
      ),
    );
    return;
  }
  reloading = true;
  location.reload();
}
export async function applyUpdate() {
  if (applying || !state.available) return;
  const blocked = updateBlockReason();
  if (blocked) {
    publish({ ...state, status: "ready", message: blocked });
    return;
  }
  const worker = registration?.waiting || registration?.active;
  if (!worker) return;
  applying = true;
  const build = state.available;
  publish({ ...state, status: "applying", message: "Updating app…" });
  try {
    const result = await message<{ ok: boolean }>(worker, {
      type: "APPLY_UPDATE",
      build,
    });
    if (!result.ok) {
      unlockUpdate();
      intended = "";
      publish({
        status: "ready",
        available: build,
        message:
          "Finish or close forms in other Mendocean windows, then try again.",
      });
    } else {
      intended = build;
      intendedWorker = worker;
      await reloadFor(build);
      setTimeout(() => {
        if (!reloading && intended === build) {
          unlockUpdate();
          publish({
            status: "ready",
            available: build,
            message: "Update is ready. Try applying it again.",
          });
        }
      }, 8000);
    }
  } catch {
    unlockUpdate();
    intended = "";
    publish({
      status: "ready",
      available: build,
      message: "Unable to apply the update. Please try again.",
    });
  } finally {
    applying = false;
  }
}
export function checkForUpdates(manual = false, entry = false): Promise<void> {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) {
    publish({
      status: "current",
      message: "Updates are available in the installed production app.",
    });
    return Promise.resolve();
  }
  if (checking) return checking;
  if (!manual && Date.now() - lastCheck < 60000) return Promise.resolve();
  lastCheck = Date.now();
  autoAtEntry = entry;
  checking = (async () => {
    if (!navigator.onLine) throw new Error("Offline");
    publish({ status: "checking", message: "Checking for updates…" });
    registration ||= await navigator.serviceWorker.register("/sw.js", {
      updateViaCache: "none",
    });
    if (!started) {
      started = true;
      registration.addEventListener("updatefound", () =>
        observe(registration!.installing),
      );
    }
    observe(registration.installing);
    await registration.update();
    observe(registration.installing);
    if (registration.waiting) await offer(registration.waiting);
    else if (registration.installing)
      publish({ status: "downloading", message: "Downloading update…" });
    else if (registration.active) await offer(registration.active);
  })()
    .catch(failed)
    .finally(() => {
      checking = undefined;
    });
  return checking;
}
export function startAppUpdates(savePosition: () => void) {
  beforeReload = savePosition;
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return () => {};
  try {
    if (sessionStorage.getItem("mendocean-update-attempt") === APP_BUILD)
      sessionStorage.removeItem("mendocean-update-attempt");
  } catch {
    /* A blocked session store must not prevent update checks. */
  }
  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (data?.type === "APP_VERSION")
      event.ports[0]?.postMessage({ build: APP_BUILD });
    if (data?.type === "PREPARE_UPDATE") {
      void prepareUpdate().then((safe) => {
        if (safe) {
          intended = data.build;
          intendedWorker = event.source as ServiceWorker;
        }
        event.ports[0]?.postMessage({ safe, build: APP_BUILD });
      });
    }
    if (data?.type === "CANCEL_UPDATE") {
      intended = "";
      unlockUpdate();
    }
    if (data?.type === "COMMIT_UPDATE")
      void reloadFor(data.build).catch(failed);
  };
  const changed = () => {
    if (intended) void reloadFor(intended).catch(failed);
    else if (registration?.active)
      void offer(registration.active).catch(failed);
  };
  const onReturn = () => {
    if (document.visibilityState === "visible")
      void checkForUpdates(false, true);
  };
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") void checkForUpdates();
  }, 5 * 60000);
  navigator.serviceWorker.addEventListener("message", onMessage);
  navigator.serviceWorker.addEventListener("controllerchange", changed);
  window.addEventListener("pageshow", onReturn);
  window.addEventListener("focus", onReturn);
  window.addEventListener("online", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  void checkForUpdates(false, true);
  return () => {
    clearInterval(timer);
    navigator.serviceWorker.removeEventListener("message", onMessage);
    navigator.serviceWorker.removeEventListener("controllerchange", changed);
    window.removeEventListener("pageshow", onReturn);
    window.removeEventListener("focus", onReturn);
    window.removeEventListener("online", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
  };
}
