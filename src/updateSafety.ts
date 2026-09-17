// App updates must never interrupt a write, pending local persistence, or an open editor.
let pending = 0;
let formReason = "";
let locked = false;
let unlockTimer: ReturnType<typeof setTimeout> | undefined;
let persistenceFailed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
export const subscribeSafety = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const updateBlockReason = () =>
  persistenceFailed
    ? "A draft could not be saved. Finish saving it before updating."
    : formReason ||
      (pending ? "A request or local save is still in progress." : "");
export function setUpdateFormReason(reason: string) {
  if (formReason === reason) return;
  formReason = reason;
  changed();
}
export async function protectWork<T>(work: () => Promise<T>): Promise<T> {
  if (locked) throw new Error("The app is updating. Try again shortly.");
  pending++;
  changed();
  try {
    return await work();
  } finally {
    pending--;
    changed();
  }
}
export async function protectLocalSave<T>(work: () => Promise<T>): Promise<T> {
  try {
    const value = await protectWork(work);
    persistenceFailed = false;
    changed();
    return value;
  } catch (e) {
    persistenceFailed = true;
    changed();
    throw e;
  }
}
export function unlockUpdate() {
  locked = false;
  clearTimeout(unlockTimer);
  document.getElementById("root")?.removeAttribute("inert");
}
export function lockUpdate() {
  if (updateBlockReason()) return false;
  locked = true;
  document.getElementById("root")?.setAttribute("inert", "");
  clearTimeout(unlockTimer);
  unlockTimer = setTimeout(unlockUpdate, 8000);
  return true;
}

// Let a just-started local save finish; an open form never waits or activates.
export async function prepareUpdate() {
  const deadline = performance.now() + 1000;
  while (
    pending &&
    !formReason &&
    !persistenceFailed &&
    performance.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 25));
  return lockUpdate();
}
