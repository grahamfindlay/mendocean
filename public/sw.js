const SHELL = "mendocean-shell-v3";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const response = await fetch("/");
      if (!response.ok) throw new Error("App shell unavailable");
      const html = await response.clone().text();
      await cache.put("/", response);
      const assets = [
        ...new Set(html.match(/\/assets\/[^"'\s<>]+\.(?:js|css)/g) || []),
      ];
      await cache.addAll([
        ...assets,
        "/icon.svg",
        "/icon-180.png",
        "/icon-192.png",
        "/icon-512.png",
        "/manifest.webmanifest",
      ]);
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k.startsWith("mendocean-shell-") && k !== SHELL)
              .map((k) => caches.delete(k)),
          ),
        ),
    ]),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Cache only public static files, never APIs, authentication, or other origins.
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/functions")
  )
    return;
  if (event.request.mode === "navigate")
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        try {
          const response = await fetch(event.request);
          if (response.ok)
            await cache.put("/", response.clone()).catch(() => {});
          return response;
        } catch {
          return (
            (await cache.match("/")) ||
            new Response("Reconnect to load the app.", { status: 503 })
          );
        }
      })(),
    );
  else if (url.pathname.startsWith("/assets/"))
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const saved = await cache.match(event.request);
        if (saved) return saved;
        const response = await fetch(event.request);
        if (response.ok)
          await cache.put(event.request, response.clone()).catch(() => {});
        return response;
      }),
    );
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
