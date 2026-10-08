import { useState } from "react";
import { supabase } from "./client";
export default function StagingControls({
  onUpdated,
}: {
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function trigger(action: string) {
    setBusy(true);
    setMessage("");
    try {
      const { data } = await supabase!.auth.getSession();
      const response = await fetch(
        import.meta.env.VITE_SUPABASE_URL + "/functions/v1/staging-test",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: "Bearer " + data.session?.access_token,
          },
          body: JSON.stringify({ action }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Test failed");
      setMessage(result.message);
      onUpdated();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Lineup notification testing">
      <h3>Lineup notification testing</h3>
      <p>
        Fictional crew · Sends only to this test account using your saved lineup
        preferences. After triggering, close the app and wait up to 90 seconds.
      </p>
      <div className="button-row">
        {[
          ["reset", "Reset to unpublished"],
          ["publish", "Publish test lineup"],
          ["seat", "Move my seat"],
          ["crew", "Change my crew"],
          ["remove", "Remove me from boat"],
        ].map(([action, label]) => (
          <button
            type="button"
            className="button subtle"
            key={action}
            disabled={busy}
            onClick={() => void trigger(action)}
          >
            {label}
          </button>
        ))}
      </div>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </section>
  );
}
