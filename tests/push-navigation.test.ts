import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

function worker(opened: any) {
  const listeners = new Map<string, (e: any) => void>();
  const openWindow = vi.fn(async () => opened);
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    __MENDOCEAN_RELEASE__: { id: "test", assets: [] },
    URL,
    self: {
      location: { origin: "https://example.test" },
      clients: { openWindow },
      addEventListener: (type: string, listener: (e: any) => void) =>
        listeners.set(type, listener),
    },
  });
  async function click(url: string) {
    const pending: Promise<void>[] = [];
    listeners.get("notificationclick")!({
      notification: { close() {}, data: { url } },
      waitUntil: (p: Promise<void>) => pending.push(p),
    });
    await Promise.all(pending);
  }
  return { openWindow, click };
}
const target = "https://example.test/?tab=Lineups&lineup=practice";
test("a freshly opened notification window receives its destination without another reload", async () => {
  const client = {
    url: target,
    navigate: vi.fn(),
    postMessage: vi.fn(),
    focus: vi.fn(),
  };
  const w = worker(client);
  await w.click(target);
  expect(w.openWindow).toHaveBeenCalledWith(target);
  expect(client.navigate).not.toHaveBeenCalled();
  expect(client.postMessage).toHaveBeenCalledWith({
    type: "NOTIFICATION_NAVIGATE",
    url: target,
  });
  expect(client.focus).toHaveBeenCalledOnce();
});
test("an existing app returned at its home URL is navigated to the notification practice", async () => {
  const navigated = { postMessage: vi.fn(), focus: vi.fn() };
  const client = {
    url: "https://example.test/",
    navigate: vi.fn(async () => navigated),
  };
  await worker(client).click(target);
  expect(client.navigate).toHaveBeenCalledWith(target);
  expect(navigated.postMessage).toHaveBeenCalledWith({
    type: "NOTIFICATION_NAVIGATE",
    url: target,
  });
  expect(navigated.focus).toHaveBeenCalledOnce();
});
test("failed native window navigation still delivers the link to the existing app", async () => {
  const client = {
    url: "https://example.test/",
    navigate: vi.fn(async () => {
      throw new Error("Navigation unavailable");
    }),
    postMessage: vi.fn(),
    focus: vi.fn(),
  };
  await worker(client).click(target);
  expect(client.postMessage).toHaveBeenCalledWith({
    type: "NOTIFICATION_NAVIGATE",
    url: target,
  });
  expect(client.focus).toHaveBeenCalledOnce();
});
test("foreign notification URLs are refused and null window results are tolerated", async () => {
  const w = worker(null);
  await w.click("https://other.test/?tab=Lineups");
  expect(w.openWindow).not.toHaveBeenCalled();
  await expect(w.click(target)).resolves.toBeUndefined();
});
