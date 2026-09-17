// Diagnostic reproducer only; no Mendocean code or external services.
import { createServer } from "node:http";
import { webkit } from "@playwright/test";
const server = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/sw.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(
      `self.addEventListener('install',e=>e.waitUntil(caches.open('probe').then(c=>c.add('/'))));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`,
    );
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<h1>Offline probe</h1><script>navigator.serviceWorker.register("/sw.js")</script>',
    );
  }
});
await new Promise((r) => server.listen(4199, "127.0.0.1", r));
const browser = await webkit.launch();
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.goto("http://127.0.0.1:4199/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", r, {
          once: true,
        }),
      );
  });
  await page.waitForFunction(
    () => navigator.serviceWorker.controller?.state === "activated",
  );
  await context.setOffline(true);
  await page.reload({ timeout: 10000 });
  console.log("Minimal WebKit offline cached navigation passed");
} catch (e) {
  console.log("Minimal WebKit offline cached navigation failed:", e.message);
} finally {
  await browser.close();
  server.close();
}
