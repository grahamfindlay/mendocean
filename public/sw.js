// Replaced by the build plugin. The registration URL and scope never change.
const RELEASE = __MENDOCEAN_RELEASE__;
const PREFIX = "mendocean-shell-";
const SHELL = PREFIX + RELEASE.id;
const META = "/__mendocean_release__";
const hash = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      try {
        for (const asset of RELEASE.assets) {
          const response = await fetch(asset.url, {
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(20000),
          });
          const type = response.headers.get("content-type") || "";
          const expectedType =
            !asset.type ||
            (asset.type === "javascript"
              ? /^(text|application)\/javascript(?:;|$)/i.test(type)
              : type.toLowerCase().split(";")[0] === asset.type);
          if (
            !response.ok ||
            !expectedType ||
            (await hash(await response.clone().arrayBuffer())) !== asset.hash
          )
            throw new Error("Incomplete app release");
          await cache.put(asset.url, response);
        }
        await cache.put(META, new Response(JSON.stringify(RELEASE)));
        // Existing installations wait for a coordinated safe activation.
      } catch (error) {
        await caches.delete(SHELL);
        throw error;
      }
    })(),
  ),
);
const windows = () =>
  self.clients.matchAll({ type: "window", includeUncontrolled: true });
function ask(client, type) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (value) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 2000);
    channel.port1.onmessage = (e) => finish(e.data);
    client.postMessage({ type, build: RELEASE.id }, [channel.port2]);
  });
}
async function broadcast(type) {
  for (const client of await windows())
    client.postMessage({ type, build: RELEASE.id });
}
async function cleanup() {
  const clients = await windows();
  const versions = await Promise.all(clients.map((c) => ask(c, "APP_VERSION")));
  // A suspended or legacy page may still need its old assets.
  if (versions.some((v) => !v?.build)) return;
  const keep = new Set([RELEASE.id, ...versions.map((v) => v.build)]);
  const names = (await caches.keys()).filter((k) => k.startsWith(PREFIX));
  const releases = await Promise.all(
    names.map(async (name) => ({
      name,
      meta: await (await (await caches.open(name)).match(META))?.json(),
    })),
  );
  releases.sort((a, b) => (b.meta?.created || 0) - (a.meta?.created || 0));
  // At most two unused generations, plus any version with a live client.
  for (const r of releases.slice(0, 2)) if (r.meta) keep.add(r.meta.id);
  await Promise.all(
    releases
      .filter((r) =>
        r.meta ? !keep.has(r.meta.id) : /^mendocean-shell-v\d+$/.test(r.name),
      )
      .map((r) => caches.delete(r.name)),
  );
}
let applying = false;
self.addEventListener("message", (event) => {
  const reply = (value) => event.ports[0]?.postMessage(value);
  if (event.data?.type === "GET_VERSION") {
    reply({ build: RELEASE.id });
    return;
  }
  if (event.data?.type === "CLAIM" && event.data.build === RELEASE.id) {
    event.waitUntil(self.clients.claim());
    return;
  }
  if (event.data?.type === "CLEANUP") {
    event.waitUntil(cleanup());
    return;
  }
  if (event.data?.type !== "APPLY_UPDATE" || event.data.build !== RELEASE.id)
    return;
  event.waitUntil(
    (async () => {
      if (applying) {
        reply({ ok: false });
        return;
      }
      applying = true;
      try {
        const clients = await windows();
        const states = await Promise.all(
          clients.map((c) => ask(c, "PREPARE_UPDATE")),
        );
        if (states.some((s) => !s?.safe)) {
          await broadcast("CANCEL_UPDATE");
          reply({ ok: false });
          return;
        }
        reply({ ok: true });
        const wasWaiting = !!self.registration.waiting;
        void self.skipWaiting();
        if (!wasWaiting) {
          // Also handles a page whose controller is already newer than its JS.
          await broadcast("COMMIT_UPDATE");
        }
      } finally {
        applying = false;
      }
    })(),
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await broadcast("COMMIT_UPDATE");
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () =>
        (await (await caches.open(SHELL)).match("/")) ||
        fetch(event.request))(),
    );
  } else if (
    RELEASE.assets.some((a) => a.url === url.pathname) ||
    url.pathname.startsWith("/assets/")
  ) {
    event.respondWith(
      (async () => {
        const current = await (await caches.open(SHELL)).match(url.pathname);
        if (current) return current;
        // Hashed assets requested by an older, still open page remain available.
        for (const name of (await caches.keys()).filter((k) =>
          k.startsWith(PREFIX),
        )) {
          const saved = await (await caches.open(name)).match(url.pathname);
          if (saved) return saved;
        }
        return fetch(event.request);
      })(),
    );
  }
  // build.json, APIs, Auth and other origins always bypass shell storage.
});
self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "How was the water?", {
      body: data.body || "Take a moment to log your outing.",
      tag: data.tag || "mendocean-reminder",
      icon: "/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  );
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.openWindow(url.href));
});
