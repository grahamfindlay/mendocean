import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lockUpdate,
  unlockUpdate,
  updateBlockReason,
  setUpdateFormReason,
  protectWork,
  protectLocalSave,
  prepareUpdate,
  subscribeSafety,
} from "../src/updateSafety";
const attributes = new Set<string>();
beforeEach(() => {
  vi.stubGlobal("document", {
    getElementById: () => ({
      setAttribute: (key: string) => attributes.add(key),
      removeAttribute: (key: string) => attributes.delete(key),
    }),
  });
  vi.useFakeTimers();
});
afterEach(async () => {
  unlockUpdate();
  setUpdateFormReason("");
  await protectLocalSave(async () => {});
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("safe app update boundary", () => {
  it("blocks all the way through a pending write, including a rejection", async () => {
    let reject!: (error: Error) => void;
    const writing = protectWork(
      () =>
        new Promise<void>((_, no) => {
          reject = no;
        }),
    );
    expect(lockUpdate()).toBe(false);
    reject(new Error("write failed"));
    await expect(writing).rejects.toThrow("write failed");
    expect(updateBlockReason()).toBe("");
    expect(lockUpdate()).toBe(true);
  });
  it("locks new requests during activation and releases a stalled update", async () => {
    expect(lockUpdate()).toBe(true);
    expect(attributes.has("inert")).toBe(true);
    const work = vi.fn(async () => {});
    await expect(protectWork(work)).rejects.toThrow("updating");
    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(8000);
    expect(attributes.has("inert")).toBe(false);
    await protectWork(work);
    expect(work).toHaveBeenCalledOnce();
  });
  it("never treats an unsaved draft as safe after persistence fails", async () => {
    await expect(
      protectLocalSave(async () => {
        throw new Error("quota");
      }),
    ).rejects.toThrow("quota");
    expect(lockUpdate()).toBe(false);
    expect(updateBlockReason()).toContain("draft could not be saved");
    await protectLocalSave(async () => {});
    expect(lockUpdate()).toBe(true);
  });
  it("defers for open forms and permits activation after they close", () => {
    setUpdateFormReason("Finish editing");
    expect(lockUpdate()).toBe(false);
    setUpdateFormReason("");
    expect(lockUpdate()).toBe(true);
  });
  it("waits for the final draft write and notifies controls when it becomes safe", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSafety(listener);
    let finish!: () => void;
    const write = protectLocalSave(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const prepared = prepareUpdate();
    expect(attributes.has("inert")).toBe(false);
    finish();
    await write;
    await vi.advanceTimersByTimeAsync(25);
    expect(await prepared).toBe(true);
    expect(listener.mock.calls.length).toBeGreaterThan(1);
    unsubscribe();
  });
});
