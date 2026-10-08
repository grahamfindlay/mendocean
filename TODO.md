# Project TODOs

## Improve the Lake Mendota webcam feed

- [ ] Ask the UW–Madison Center for Limnology webcam maintainers about an HTTPS snapshot endpoint, cross-origin access, freshness information, and supported use in Mendocean. The draft below has not been sent.
- [ ] Record their response, preferred attribution, permission to display the feed, and recommended refresh interval here or in [the camera notes](docs/LAKE_CAMERA.md).
- [ ] Evaluate their endpoint and choose whether to fetch it directly or retain Mendocean's relay. Verify HTTPS, response headers, image freshness, caching, failures, and behavior in the website and Capacitor apps before changing production.

### What we want and why

Mendocean currently displays JPEG snapshots through its own HTTPS Cloudflare relay. The relay fetches the camera over HTTP, validates the image, and shares snapshots through a one-second cache within each Cloudflare data center. The viewer requests at most one frame per second while visible and pauses when closed, offscreen, or in the background. See [the camera notes](docs/LAKE_CAMERA.md) for the current implementation.

An operator-maintained endpoint would give us a stable integration and could remove infrastructure we currently maintain. Request:

1. **A stable HTTPS URL returning the latest JPEG directly**, with `Content-Type: image/jpeg`, a valid certificate, and automatic certificate renewal. HTTPS protects the image in transit and works with secure websites and mobile apps. An HTTPS proxy in front of the existing camera is sufficient; replacement hardware or a new video player is unnecessary.
2. **Cross-Origin Resource Sharing (CORS) support for the public snapshot response.** Our interface retrieves the image with JavaScript `fetch()`, so HTTPS alone does not enable direct cross-origin retrieval. For public images accessed without cookies or credentials, `Access-Control-Allow-Origin: *` would support both the website and the different origins used by packaged iOS and Android apps. If their policy requires an origin allowlist, agree on the website and app origins before implementation. See the [Fetch standard](https://fetch.spec.whatwg.org/#http-access-control-allow-origin).
3. **An agreed refresh interval and short caching**, ideally through their web server or CDN rather than sending every viewer request to the camera. Our current one-frame-per-second target is negotiable. A stable cached snapshot is preferable to burdening the camera or serving unexpectedly old images.
4. **Capture freshness information**, if available, such as an image timestamp or documented capture-time metadata. A time when an image was downloaded is not necessarily the time it was captured; capture time would help identify a frozen feed. Custom response headers would need to be exposed through CORS if the app reads them.
5. **Permission to display the feed, preferred attribution, and a contact for endpoint changes or outages.** Keep any usage conditions with the integration notes.

This outreach is not a prerequisite for Capacitor. We can retain our relay and adapt its CORS response for the apps ourselves. HTTPS alone from the operators would still improve the upstream connection; HTTPS plus CORS could allow direct retrieval. Decide whether to remove the relay only after considering its caching and image validation.

### Draft message to the maintainers

**Subject: HTTPS snapshot access for the Lake Mendota webcam**

Hello,

I'm building Mendocean (https://mendocean.fyi), a Lake Mendota rowing forecast and reporting app. I would like to display your webcam with appropriate attribution so rowers can view the lake alongside the forecast.

The current camera snapshot endpoint is available over HTTP. Mendocean currently retrieves those snapshots through an HTTPS relay that I maintain. Would you be able to provide a stable HTTPS URL that returns the latest JPEG image directly, with a valid certificate and `Content-Type: image/jpeg`? An HTTPS proxy or cached snapshot endpoint in front of the existing camera would work; this would not require replacing the camera.

Could that public image response also include `Access-Control-Allow-Origin: *`? This CORS header would let our website and planned iOS and Android apps retrieve the image directly without cookies or login credentials. HTTPS secures the connection, while CORS permits the app's JavaScript to read the image from your server. Together they could let us retire our relay and use an endpoint maintained by you.

Our viewer currently requests at most one snapshot per second while visible and pauses when closed, offscreen, or in the background. We're happy to use a slower interval or a cached endpoint if you recommend it to protect the camera and limit bandwidth. If you can provide the image's capture time, that would also help us distinguish a current view from a frozen feed.

Please let me know whether displaying the feed in Mendocean is acceptable, your preferred attribution, any usage conditions or recommended refresh interval, and whom to contact if the endpoint changes. If you can offer HTTPS but not CORS, that would still be useful: we can keep our relay and secure its connection to your feed.

Thank you,
Graham
