import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, supabase } from "./client";
import {
  BOAT_CLASSES,
  chicagoToISO,
  localDateTime,
  formatDate,
  formatTime,
} from "../shared/domain";
import Admin from "./Admin";
import { reminderChannels } from "../shared/reminders";
import { pushEnvironment } from "./pushSupport";
import type { AccountData } from "./App";
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Auth({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Welcome to mendocean" onClose={onClose}>
      <p>Use your invited email address. We’ll send a one-time sign-in code.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (!supabase)
              throw new Error(
                "Sign-in will be available once Supabase is connected.",
              );
            const result = sent
              ? await supabase.auth.verifyOtp({
                  email,
                  token: code,
                  type: "email",
                })
              : await supabase.auth.signInWithOtp({
                  email,
                  options: { shouldCreateUser: false },
                });
            if (result.error) throw result.error;
            if (sent) onSuccess();
            else setSent(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            disabled={sent}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {sent && (
          <label>
            Sign-in code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6,8}"
              required
              autoFocus
            />
          </label>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <button className="button full" disabled={busy}>
          {busy ? "Please wait…" : sent ? "Sign in" : "Send a code"}
        </button>
        {sent && (
          <button
            className="text-button"
            type="button"
            onClick={() => setSent(false)}
          >
            Use a different email / resend
          </button>
        )}
      </form>
    </Modal>
  );
}
export function PlanForm({
  onSave,
}: {
  onSave: (body: unknown) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await onSave({
            id: crypto.randomUUID(),
            kind: "independent",
            title: f.get("title"),
            starts_at: chicagoToISO(String(f.get("start"))),
            ends_at: chicagoToISO(String(f.get("end"))),
            planned_boat: f.get("boat") || null,
            reminder: f.get("reminder") === "on",
          });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="help">
        Add a personal outing. This does not sign you up for a BHC practice.
      </p>
      <label>
        Name
        <input
          name="title"
          required
          defaultValue="Independent row"
          maxLength={120}
        />
      </label>
      <label>
        Start · Madison time
        <input
          name="start"
          type="datetime-local"
          required
          defaultValue={localDateTime(
            new Date(Date.now() + 86400000).toISOString(),
          )}
        />
      </label>
      <label>
        End
        <input
          name="end"
          type="datetime-local"
          required
          defaultValue={localDateTime(
            new Date(Date.now() + 90000000).toISOString(),
          )}
        />
      </label>
      <label>
        Planned boat
        <select name="boat">
          <option value="">Not sure yet</option>
          {BOAT_CLASSES.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input type="checkbox" name="reminder" />
        Remind me to log, 15 minutes after the outing ends
      </label>
      <p className="help">Choose email, push, or both in Account.</p>
      {error && <p className="alert">{error}</p>}
      <button className="button full" disabled={busy}>
        Save outing
      </button>
    </form>
  );
}
export function SettingsForm({
  account,
  onUpdated,
  onSignOut,
}: {
  account: AccountData | null;
  onUpdated: () => void;
  onSignOut: () => void;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [club, setClub] = useState("");
  const [pushProgress, setPushProgress] = useState("");
  const [registered, setRegistered] = useState(false);
  const [deviceChecked, setDeviceChecked] = useState(false);
  const push = pushEnvironment();
  useEffect(() => {
    let active = true;
    setDeviceChecked(false);
    setRegistered(false);
    if (
      !push.supported ||
      push.permission !== "granted" ||
      (push.ios && !push.installed) ||
      !account
    ) {
      setDeviceChecked(true);
      return;
    }
    void navigator.serviceWorker
      .getRegistration()
      .then((sw) => sw?.pushManager.getSubscription())
      .then(async (subscription) => {
        if (!subscription) return false;
        return (
          await api<{ registered: boolean }>("push/status", {
            endpoint: subscription.endpoint,
          })
        ).registered;
      })
      .then((value) => {
        if (active) {
          setRegistered(!!value);
          setDeviceChecked(true);
        }
      })
      .catch(() => {
        if (active) setDeviceChecked(true);
      });
    return () => {
      active = false;
    };
  }, [account, push.supported, push.permission, push.ios, push.installed]);
  const [pushAction, setPushAction] = useState<"enable" | "test" | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Uncontrolled fields must mount with the saved profile, not loading defaults.
  if (!account) return <p role="status">Loading your account…</p>;
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(async () => {
            await api("settings", {
              display_name: f.get("name"),
              reminder_channels: ["email", "push"].filter(
                (c) => f.get(c) === "on",
              ),
              reminders_paused: f.get("paused") === "on",
            });
            setMessage("Preferences saved.");
          });
        }}
      >
        <label>
          Your name
          <input
            name="name"
            maxLength={100}
            defaultValue={account?.profile.display_name}
          />
        </label>
        <fieldset className="reminder-choices">
          <legend>Logging reminders</legend>
          <label className="checkbox">
            <input
              type="checkbox"
              name="email"
              defaultChecked={reminderChannels(account.profile).includes(
                "email",
              )}
            />
            Email
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              name="push"
              defaultChecked={reminderChannels(account.profile).includes(
                "push",
              )}
            />
            Push notifications
          </label>
        </fieldset>
        <p className="help">
          Choose email, push, or both. Leave both unchecked to turn reminders
          off. Push needs a registered device below.
        </p>
        <details className="help">
          <summary>When do changes take effect?</summary>
          <p>
            New choices apply to upcoming and unfinished reminders. Only
            selected channels are used. To repeat a reminder already sent,
            request another from My outings.
          </p>
        </details>
        <label className="checkbox">
          <input
            name="paused"
            type="checkbox"
            defaultChecked={account?.profile.reminders_paused}
          />
          Pause all reminders
        </label>
        <button className="button" disabled={busy}>
          Save preferences
        </button>
      </form>
      <hr />
      <h3>Push on this device</h3>
      {reminderChannels(account.profile).includes("push") &&
        account.push_devices === 0 && (
          <p className="alert">
            Push is selected, but no device is registered. Enable push on a
            supported device below to receive push reminders.
          </p>
        )}
      {push.ios && !push.installed ? (
        <div className="install-guidance">
          <p>
            On iPhone or iPad, install Mendocean on your Home Screen to receive
            push reminders.
          </p>
          <ol>
            <li>Open mendocean.fyi in Safari and tap Share.</li>
            <li>
              Choose Add to Home Screen. If needed, find it under Edit Actions.
            </li>
            <li>Leave Open as Web App on if offered, then tap Add.</li>
            <li>
              Open Mendocean from its new icon, sign in, and enable push in
              Account.
            </li>
          </ol>
          <p className="help">Requires iOS/iPadOS 16.4 or later.</p>
        </div>
      ) : !push.supported ? (
        <p className="help">
          This browser does not support push notifications. Email reminders are
          available above.
        </p>
      ) : push.permission === "denied" ? (
        <p className="help">
          Notifications are blocked. Allow Mendocean notifications in your
          browser or device settings, then return here.
        </p>
      ) : (
        <p className="help">
          {!deviceChecked
            ? "Checking this device…"
            : registered
              ? "This device is registered for push."
              : push.permission === "granted"
                ? "Notification permission is granted. Register this device to connect it to your account."
                : "Enable push to grant notification permission and register this device."}
        </p>
      )}
      {registered && (
        <p className="help">
          {account.profile.reminders_paused
            ? "Logging reminders are paused."
            : reminderChannels(account.profile).includes("push")
              ? "Logging reminders use push notifications."
              : "To receive logging reminders here, select Push notifications above and save preferences."}
        </p>
      )}
      <button
        className="text-button"
        disabled={
          busy ||
          (push.ios && !push.installed) ||
          !push.supported ||
          push.permission === "denied"
        }
        onClick={() =>
          void run(async () => {
            setPushAction("enable");
            setPushProgress("Checking notification support…");
            try {
              if (
                !("PushManager" in window) ||
                !("Notification" in window) ||
                !("serviceWorker" in navigator)
              )
                throw new Error(
                  "Push is unavailable here. On iPhone, add this app to the Home Screen first.",
                );
              const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
              if (!key)
                throw new Error(
                  "Push notifications are awaiting server setup.",
                );
              setPushProgress("Waiting for notification permission…");
              const permission = await Notification.requestPermission();
              if (permission !== "granted")
                throw new Error(
                  permission === "denied"
                    ? "Notifications are blocked. Allow them for this site in your browser settings, then try again."
                    : "Permission was not granted. Click Enable push again to retry.",
                );
              setPushProgress("Registering this device…");
              await navigator.serviceWorker.register("/sw.js");
              let readyTimeout: ReturnType<typeof setTimeout> | undefined;
              const sw = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise<never>(
                  (_, reject) =>
                    (readyTimeout = setTimeout(
                      () =>
                        reject(
                          new Error(
                            "Device setup is taking too long. Reload the page and try again.",
                          ),
                        ),
                      15000,
                    )),
                ),
              ]).finally(() => clearTimeout(readyTimeout));
              const bytes = Uint8Array.from(
                atob(key.replace(/-/g, "+").replace(/_/g, "/")),
                (c) => c.charCodeAt(0),
              );
              const subscription =
                (await sw.pushManager.getSubscription()) ||
                (await sw.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: bytes,
                }));
              await api("push", { subscription: subscription.toJSON() });
              setRegistered(true);
              setDeviceChecked(true);
              setPushProgress(
                "This device is registered. Send a test below. For logging reminders, choose Push notifications above and save preferences.",
              );
            } catch (e) {
              setPushProgress((e as Error).message);
              throw e;
            } finally {
              setPushAction(null);
            }
          })
        }
      >
        {pushAction === "enable"
          ? "Setting up notifications…"
          : "Enable push on this device"}
      </button>
      <button
        className="text-button"
        disabled={busy || !registered || push.permission === "denied"}
        onClick={() =>
          void run(async () => {
            setPushAction("test");
            try {
              if (!("serviceWorker" in navigator) || !("PushManager" in window))
                throw new Error("Enable push on this device first.");
              const sw = await navigator.serviceWorker.getRegistration();
              const subscription = await sw?.pushManager.getSubscription();
              if (!subscription)
                throw new Error("Enable push on this device first.");
              setPushProgress("Sending a test to this device…");
              await api("push/test", { endpoint: subscription.endpoint });
              setPushProgress(
                "Test accepted by your push service. Look for a Mendocean notification. If it does not appear, check browser/OS notification settings and Focus or Do Not Disturb.",
              );
            } catch (e) {
              setPushProgress((e as Error).message);
              throw e;
            } finally {
              setPushAction(null);
            }
          })
        }
      >
        {pushAction === "test"
          ? "Sending test…"
          : "Send test notification to this device"}
      </button>
      {pushProgress && (
        <p className="notice" role="status">
          {pushProgress}
        </p>
      )}
      <hr />
      <h3>Boathouse Connect</h3>
      <p className="help">
        Optional. Import your practices and planned lineups. Your app login is
        separate.
      </p>
      {account?.bhc.connected ? (
        <>
          <p>
            Connected
            {account.bhc.last_sync
              ? " · Synced " +
                formatDate(account.bhc.last_sync) +
                " " +
                formatTime(account.bhc.last_sync)
              : ""}
          </p>
          {account.bhc.last_error && (
            <p className="alert">{account.bhc.last_error}</p>
          )}
          <div className="card-actions">
            <button
              className="button subtle"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("bhc/sync", {});
                  setMessage(
                    "Practice refresh queued. Check back in a few minutes.",
                  );
                })
              }
            >
              Refresh practices
            </button>
            <button
              className="text-button danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("bhc/disconnect", {});
                  setMessage("Disconnected. Existing reports are preserved.");
                })
              }
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("bhc/connect", {
                token,
                club_id: club ? Number(club) : undefined,
              });
              setToken("");
              setMessage("Connected. Your practices are being imported.");
            });
          }}
        >
          <label>
            BHC API token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </label>
          <label>
            Club ID (only if you belong to multiple clubs)
            <input
              inputMode="numeric"
              value={club}
              onChange={(e) => setClub(e.target.value)}
            />
          </label>
          <button className="button subtle" disabled={busy}>
            Connect account
          </button>
        </form>
      )}
      {account?.profile.role === "admin" && (
        <>
          <hr />
          <h3>Invite a pilot user</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await api("invite", { email: f.get("email") });
                setMessage(
                  "Account created. The person can request a sign-in code.",
                );
              });
            }}
          >
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <button className="button subtle" disabled={busy}>
              Create invited account
            </button>
          </form>
        </>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {account?.profile.role === "admin" && <Admin />}
      <hr />
      <button className="text-button" onClick={onSignOut}>
        Sign out
      </button>
      <p className="help">
        Unsent drafts stay on this device and are only shown when you sign back
        into this account.
      </p>
    </>
  );
}
