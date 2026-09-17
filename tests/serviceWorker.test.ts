import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("cache cleanup retains an in-progress install, live client versions and the two newest complete shells", async () => {
  const prefix = "mendocean-shell-";
  const stored = new Map<string, { id: string; created: number } | undefined>([
    [prefix + "old", { id: "old", created: 1 }],
    [prefix + "live", { id: "live", created: 2 }],
    [prefix + "previous", { id: "previous", created: 3 }],
    [prefix + "current", { id: "current", created: 4 }],
    [prefix + "installing", undefined],
    ["unrelated-cache", undefined],
    [prefix + "v6", undefined],
  ]);
  const handlers = new Map<string, (event: unknown) => void>();
  const source = readFileSync("public/sw.js", "utf8").replace(
    "__MENDOCEAN_RELEASE__",
    JSON.stringify({ id: "current", assets: [] }),
  );
  runInNewContext(source, {
    self: {
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        handlers.set(type, handler),
      clients: {
        matchAll: async () => [
          {
            postMessage: (_: unknown, ports: MessagePort[]) =>
              ports[0].postMessage({ build: "live" }),
          },
        ],
      },
    },
    caches: {
      keys: async () => [...stored.keys()],
      open: async (name: string) => ({
        match: async () =>
          stored.get(name)
            ? new Response(JSON.stringify(stored.get(name)))
            : undefined,
      }),
      delete: async (name: string) => stored.delete(name),
    },
    MessageChannel,
    setTimeout,
    clearTimeout,
  });
  let work!: Promise<void>;
  handlers.get("message")!({
    data: { type: "CLEANUP" },
    waitUntil: (promise: Promise<void>) => {
      work = promise;
    },
  });
  await work;
  expect([...stored.keys()]).toEqual([
    prefix + "live",
    prefix + "previous",
    prefix + "current",
    prefix + "installing",
    "unrelated-cache",
  ]);
});
