const CAMERA_URL = "http://mendota-camera-origin.mendocean.fyi/nph-jpeg.cgi?0";
const MAX_BYTES = 2 * 1024 * 1024;
type CameraCache = Pick<Cache, "match" | "put">;

export async function cameraResponse(
  request: Request,
  cache?: CameraCache,
  upstreamFetch: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "GET")
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  const key = new Request(new URL("/api/lake-camera.jpg", request.url));
  const outgoing = (response: Response) => {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  };
  try {
    const saved = await cache?.match(key);
    if (saved) return outgoing(saved);
    const upstream = await upstreamFetch(CAMERA_URL, {
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
    });
    if (
      !upstream.ok ||
      upstream.headers.get("content-type")?.split(";")[0] !== "image/jpeg" ||
      !upstream.body
    ) {
      await upstream.body?.cancel();
      throw new Error("Invalid camera response");
    }
    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Image too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[length - 2] !== 255 ||
      bytes[length - 1] !== 217
    )
      throw new Error("Invalid JPEG");
    const response = new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=1",
        "X-Content-Type-Options": "nosniff",
        "X-Camera-Fetched-At": new Date().toISOString(),
      },
    });
    await cache?.put(key, response.clone());
    return outgoing(response);
  } catch {
    return new Response("Camera temporarily unavailable", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
