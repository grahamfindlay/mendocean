import { describe, expect, it, vi } from "vitest";
import { cameraResponse } from "../shared/camera-relay";
const jpeg = new Uint8Array([255, 216, 1, 255, 217]);
const request = () =>
  new Request(
    "https://mendocean.fyi/api/lake-camera.jpg?url=http://evil.example",
  );
describe("camera relay", () => {
  it("fetches only the fixed origin and caches valid images for one second", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(jpeg, { headers: { "content-type": "image/jpeg" } }),
      );
    let saved: Response | undefined;
    const cache = {
      match: vi.fn(async () => saved?.clone()),
      put: vi.fn(async (_: RequestInfo | URL, response: Response) => {
        saved = response;
      }),
    };
    const first = await cameraResponse(request(), cache, fetcher);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(saved?.headers.get("cache-control")).toBe("public, max-age=1");
    expect(fetcher.mock.calls[0][0]).toBe(
      "http://mendota-camera-origin.mendocean.fyi/nph-jpeg.cgi?0",
    );
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
    const second = await cameraResponse(request(), cache, fetcher);
    expect(second.headers.get("X-Camera-Fetched-At")).toBe(
      first.headers.get("X-Camera-Fetched-At"),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    new Response("<html>error</html>", {
      headers: { "content-type": "text/html" },
    }),
    new Response("not jpeg", { headers: { "content-type": "image/jpeg" } }),
    new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
      headers: { "content-type": "image/jpeg" },
    }),
    new Response(null, { status: 503 }),
  ])("rejects invalid upstream responses without caching", async (response) => {
    const put = vi.fn();
    const result = await cameraResponse(
      request(),
      { match: async () => undefined, put },
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    expect(result.status).toBe(502);
    expect(put).not.toHaveBeenCalled();
  });
  it("handles network failures and rejects writes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network"));
    expect((await cameraResponse(request(), undefined, fetcher)).status).toBe(
      502,
    );
    expect(
      (
        await cameraResponse(
          new Request(request(), { method: "POST" }),
          undefined,
          fetcher,
        )
      ).status,
    ).toBe(405);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
