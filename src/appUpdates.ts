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
  autoAtEntry = false,
  entryPending = false;
let lastCheck = 0;
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
    // Launch and foreground boundaries still apply a waiting release on their
    // own -- that is what keeps an installed app current without anyone
    // tapping anything. What is gone is the gate that used to poll every open
    // window first and cancel when any of them had a form open.
    applyUpdate();
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
/**
 * Apply a waiting release.
 *
 * Nothing is asked of other windows first: they keep running their own
 * release from its retained cache generation and pick this one up on their
 * next load. Only the window that asked reloads, on `controllerchange`.
 */
export function applyUpdate() {
  if (applying || !state.available) return;
  const worker = registration?.waiting;
  applying = true;
  publish({ ...state, status: "applying", message: "Updating app…" });
  if (!worker) return reload();
  worker.postMessage({ type: "SKIP_WAITING" });
  // controllerchange does the reload; this is the backstop for a worker that
  // never takes control.
  setTimeout(() => {
    if (!reloading) reload();
  }, 4000);
}
function reload() {
  if (reloading) return;
  reloading = true;
  beforeReload();
  location.reload();
}
export function checkForUpdates(manual = false, entry = false): Promise<void> {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) {
    publish({
      status: "current",
      message: "Updates are available in the installed production app.",
    });
    return Promise.resolve();
  }
  if (checking) {
    // A foreground boundary can arrive while an older check is settling;
    // keep its intent to apply rather than losing it to that older result.
    entryPending ||= entry;
    return checking;
  }
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
      if (entryPending) {
        entryPending = false;
        if (!reloading) void checkForUpdates(true, true);
      }
    });
  return checking;
}
export function startAppUpdates(savePosition: () => void) {
  beforeReload = savePosition;
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return () => {};
  const onMessage = (event: MessageEvent) => {
    // Cache cleanup asks live windows which release they are still using.
    if (event.data?.type === "APP_VERSION")
      event.ports[0]?.postMessage({ build: APP_BUILD });
  };
  const changed = () => {
    if (applying) reload();
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
