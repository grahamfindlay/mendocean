// Local-only production-release fixture. Never included in the deployed app.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
export async function startReleaseServer(root, secret, port = 4175) {
  let release = "a",
    failure = null;
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/__test/release") {
      if (req.method !== "POST" || req.headers["x-fixture-secret"] !== secret) {
        res.writeHead(403).end();
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      const patch = JSON.parse(body);
      if (!["a", "b", "c", "legacy"].includes(patch.release)) {
        res.writeHead(400).end();
        return;
      }
      release = patch.release;
      failure = patch.failure || null;
      res.setHeader("Content-Type", "application/json");
      res.end(await readFile(resolve(root, "dist-" + release, "build.json")));
      return;
    }
    const dir = resolve(root, "dist-" + release);
    let path = resolve(dir, "." + decodeURIComponent(url.pathname));
    if (path !== dir && !path.startsWith(dir + "/")) {
      res.writeHead(403).end();
      return;
    }
    if (
      (failure === "worker" && url.pathname === "/sw.js") ||
      (failure === "metadata" && url.pathname === "/build.json")
    ) {
      res.writeHead(503).end();
      return;
    }
    // Simulates a CDN returning a 200 HTML fallback for an unavailable JS asset.
    if (
      failure === "asset" &&
      url.pathname.startsWith("/assets/") &&
      path.endsWith(".js")
    )
      path = resolve(dir, "index.html");
    try {
      if (!(await stat(path)).isFile()) path = resolve(dir, "index.html");
    } catch {
      path = resolve(dir, "index.html");
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Type",
      types[extname(path)] || "application/octet-stream",
    );
    res.end(await readFile(path));
  });
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
  return server;
}
