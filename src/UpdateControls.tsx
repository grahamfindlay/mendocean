import { useSyncExternalStore } from "react";
import {
  APP_BUILD,
  applyUpdate,
  checkForUpdates,
  subscribeUpdates,
  updateSnapshot,
} from "./appUpdates";
export function UpdateBanner() {
  const state = useSyncExternalStore(subscribeUpdates, updateSnapshot);
  if (!["ready", "applying"].includes(state.status)) return null;
  return (
    <aside className="app-update" aria-label="App update">
      <p role="status">{state.message}</p>
      {state.status === "ready" && (
        <button className="button subtle" onClick={() => applyUpdate()}>
          Update now
        </button>
      )}
    </aside>
  );
}
export function UpdateSettings() {
  const state = useSyncExternalStore(subscribeUpdates, updateSnapshot);
  return (
    <section className="update-settings" aria-label="App version and updates">
      <h3>App updates</h3>
      <button
        type="button"
        className="button subtle"
        disabled={["checking", "downloading", "applying"].includes(
          state.status,
        )}
        onClick={() => void checkForUpdates(true)}
      >
        Check for updates
      </button>
      <p role="status">{state.message}</p>
      {state.status === "ready" && (
        <p className="help">
          Choose Update now. Unsent work on this device is kept.
        </p>
      )}
      <details className="help">
        <summary>App version</summary>
        <p className="app-version">{APP_BUILD}</p>
      </details>
    </section>
  );
}
