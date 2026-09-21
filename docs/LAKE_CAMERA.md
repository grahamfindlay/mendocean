# Lake camera

Today’s Now card offers an opt-in JPEG viewer. It requests no frames while closed, pauses offscreen or in a background tab, aborts requests on cleanup, and targets at most one request start per second with no overlapping requests. Failed requests back off from 2 to 30 seconds. The last decoded image stays visible during refresh. A compact camera toggle shares the Now heading; the expanded view contains only the image (plus a message if retrieval fails).

## Deployment prerequisite

Before merging, add a **DNS-only A record** in the existing mendocean.fyi Cloudflare zone:

- Name: `mendota-camera-origin`
- Address: `144.92.62.155`

Cloudflare Workers cannot fetch a literal IP with fetch; the camera was tested successfully using this hostname via a local DNS override. Do not proxy this origin record. No camera credentials are required. The upstream hop remains HTTP; the browser-facing endpoint is HTTPS.

Cloudflare Pages builds the root `functions/api/lake-camera.jpg.ts` handler. `_routes.json` limits function execution to this endpoint; other app routes remain static. The handler fetches only the fixed JPEG URL (never a user-supplied URL), rejects redirects and non-JPEG/oversized responses, and times out after eight seconds. A one-second Cache API entry shares frames within each Cloudflare data center; it is not a global request limit. Browser and service-worker caches do not retain frames. No player dependency or video transcoding is needed.

Verify on a deployed preview or production after DNS setup: endpoint returns image/jpeg over HTTPS; repeated requests within one second reuse X-Camera-Fetched-At; a later request updates it; the Now card displays images; closing it stops requests. Cloudflare origin connectivity was verified on a deployed preview on September 20, 2026. The DNS record above is installed. Cloudflare requires `redirect: "manual"`; redirects are rejected by the non-OK response check. Recheck the endpoint after each production deployment.

Local Vite development has no production relay. Browser tests intercept this endpoint with a JPEG fixture; do not point automated tests at the real camera. A plain Vite session displays the unavailable state with an external webcam link.

Observed evening images were about 28 KB (1024 × 768), approximately 1.7 MB/minute at 1 FPS. Daylight images may be larger. Original viewer: http://144.92.62.155/popup.html?0.
