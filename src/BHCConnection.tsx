import { useEffect, useId, useRef, useState } from "react";
import type { BHCConnectionStatus, BHCMethod } from "../shared/bhcConnection";
import { api, ApiError } from "./client";
import { formatDate, formatTime, BHC_LOGIN_URL } from "../shared/domain";
import { track } from "./telemetry";

export function BHCNotice({
  status,
  onReconnect,
}: {
  status: BHCConnectionStatus;
  onReconnect: () => void;
}) {
  const freshness = status.last_sync
    ? ` Last updated ${formatDate(status.last_sync)}, ${formatTime(status.last_sync)}.`
    : "";
  if (status.state === "reconnect_required")
    return (
      <div className="notice bhc-notice" role="status">
        <strong>Reconnect Boathouse Connect</strong>
        <p>
          Reconnect to update practices and attendance. Your saved logs are
          safe.{freshness}
        </p>
        <button className="button" onClick={onReconnect}>
          Reconnect BHC
        </button>
        <p className="help">
          BHC reminders are paused until practices refresh.
        </p>
      </div>
    );
  if (status.state === "membership_missing")
    return (
      <div className="notice bhc-notice" role="status">
        <strong>Mendota membership not found</strong>
        <p>Check your Mendota membership in BHC.{freshness}</p>
        <button className="button subtle" onClick={onReconnect}>
          Check connection
        </button>
      </div>
    );
  if (status.renewal_due)
    return (
      <div className="notice bhc-notice" role="status">
        <strong>
          Renew your BHC connection by{" "}
          {status.expires_at
            ? formatDate(status.expires_at)
            : "its expiry date"}
          .
        </strong>
        <p>Your connection is still working.</p>
        <button className="button subtle" onClick={onReconnect}>
          Renew BHC connection
        </button>
      </div>
    );
  if (
    status.state === "temporary_error" ||
    status.state === "import_incomplete"
  )
    return (
      <div className="notice bhc-notice" role="status">
        <strong>BHC practices could not be updated.</strong>
        <p>
          Practice and attendance details may be out of date.
          {status.last_sync &&
            ` Last updated ${formatDate(status.last_sync)}, ${formatTime(status.last_sync)}.`}
        </p>
        <button className="text-button" onClick={onReconnect}>
          Check connection
        </button>
      </div>
    );
  return null;
}

export function BHCConnection({
  user,
  status,
  onUpdated,
  focusConnection = false,
}: {
  user: string;
  status: BHCConnectionStatus;
  onUpdated: () => void;
  focusConnection?: boolean;
}) {
  const id = useId();
  const section = useRef<HTMLElement>(null);
  const [step, setStep] = useState<"status" | "choice" | "key" | "password">(
    focusConnection &&
      (status.state === "reconnect_required" || status.renewal_due)
      ? status.method === "password_exchange" && status.password_enabled
        ? "password"
        : "key"
      : "status",
  );
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState("");
  const [polling, setPolling] = useState(false);
  const [delay, setDelay] = useState(false);
  const refresh = useRef(onUpdated);
  refresh.current = onUpdated;
  const needsReconnect = status.state === "reconnect_required";
  useEffect(() => {
    if (focusConnection) {
      section.current?.scrollIntoView({ block: "start" });
      section.current?.focus();
    }
  }, [focusConnection]);
  function route(next: typeof step) {
    setToken("");
    setPassword("");
    setEmail("");
    setShow(false);
    setError("");
    setProblem("");
    setMessage("");
    setStep(next);
  }
  useEffect(() => {
    if (delay || (!polling && status.state !== "importing")) return;
    let count = 0;
    const timer = setInterval(() => {
      refresh.current();
      if (++count >= 20) {
        clearInterval(timer);
        setPolling(false);
        setDelay(true);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [polling, status.state, delay]);
  useEffect(() => {
    if (status.state === "healthy") {
      setPolling(false);
      setDelay(false);
      setMessage("");
    }
  }, [status.state, status.last_sync]);
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (!navigator.onLine) {
      setError("Connect to the internet to connect BHC.");
      return;
    }
    setBusy(true);
    setError("");
    setProblem("");
    const method: BHCMethod =
      step === "key" ? "provided_token" : "password_exchange";
    track("bhc_setup", { action: "started", method }, user);
    try {
      await api(
        step === "key" ? "bhc/connect" : "bhc/connect-password",
        step === "key"
          ? { token, request_id: crypto.randomUUID() }
          : { email, password, request_id: crypto.randomUUID() },
        user,
      );
      setDelay(false);
      setPolling(true);
      route("status");
      setMessage("Connected. Importing practices…");
      onUpdated();
      track("bhc_connection_changed", { action: "connect", method }, user);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "BHC could not confirm the connection.",
      );
      if (e instanceof ApiError) setProblem(e.code || "");
      onUpdated();
      track("bhc_setup", { action: "failed", method }, user);
    } finally {
      setToken("");
      setPassword("");
      setShow(false);
      setBusy(false);
    }
  }
  async function perform(action: "sync" | "disconnect") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`bhc/${action}`, {}, user);
      onUpdated();
      if (action === "sync") {
        setMessage("Practice refresh queued.");
        setDelay(false);
        setPolling(true);
      } else {
        route("status");
        track("bhc_connection_changed", { action: "disconnect" }, user);
      }
    } catch (e) {
      setError((e as Error).message);
      onUpdated();
    } finally {
      setBusy(false);
    }
  }
  const renew = () =>
    route(
      status.method === "password_exchange" && status.password_enabled
        ? "password"
        : "key",
    );
  return (
    <section
      ref={section}
      tabIndex={-1}
      className="bhc-connection ph-no-capture ph-no-recording"
      data-ph-no-capture="true"
      aria-label="Boathouse Connect integration"
    >
      {step === "status" ? (
        <>
          <h3>Integrate with Boathouse Connect</h3>
          <BHCNotice status={status} onReconnect={renew} />
          {status.state === "membership_missing" ? (
            <>
              <p>This BHC account isn't a member of Mendota Rowing Club.</p>
              <button
                className="button"
                disabled={busy}
                onClick={() => route("choice")}
              >
                Update BHC connection
              </button>
              <p>
                <a
                  href={BHC_LOGIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Check membership in BHC
                </a>
              </p>
            </>
          ) : status.connected || status.state === "reconnect_required" ? (
            <>
              <p>Mendota Rowing Club</p>
              <p role="status">
                {status.state === "importing"
                  ? "Connected. Importing practices…"
                  : status.state === "healthy"
                    ? status.upcoming_practices === 0
                      ? "Connected · No upcoming practices found"
                      : "Connected · Practices up to date"
                    : status.state === "reconnect_required"
                      ? "Reconnection required"
                      : "Updates unavailable"}
              </p>
              <dl className="bhc-details">
                <div>
                  <dt>Last successful update</dt>
                  <dd>
                    {status.last_sync
                      ? `${formatDate(status.last_sync)}, ${formatTime(status.last_sync)}`
                      : "Not yet confirmed"}
                  </dd>
                </div>
                <div>
                  <dt>Connection method</dt>
                  <dd>
                    {status.method === "password_exchange"
                      ? "BHC email and password"
                      : status.method === "provided_token"
                        ? "BHC API key"
                        : "API key"}
                  </dd>
                </div>
                {status.expires_at && (
                  <div>
                    <dt>Renew connection by</dt>
                    <dd>{formatDate(status.expires_at)}</dd>
                  </div>
                )}
              </dl>
              {status.connected && (
                <button
                  className="button subtle"
                  disabled={busy}
                  onClick={() => void perform("sync")}
                >
                  Refresh practices
                </button>
              )}
              <div className="card-actions">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => route("choice")}
                >
                  {needsReconnect
                    ? "Connection options"
                    : "Change connection method"}
                </button>
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => void perform("disconnect")}
                >
                  Disconnect BHC
                </button>
              </div>
            </>
          ) : (
            <>
              <p>Import your practices and manage attendance.</p>
              <button className="button" onClick={() => route("choice")}>
                Connect Boathouse Connect
              </button>
            </>
          )}
        </>
      ) : step === "choice" ? (
        <>
          <h3>Integrate with Boathouse Connect</h3>
          <p>Import your practices and manage attendance.</p>
          <div className="bhc-recommended">
            <span className="badge">Recommended</span>
            <h4>Connect using an API key</h4>
            <p>Stays connected until you revoke the API key.</p>
            <button className="button" onClick={() => route("key")}>
              Use an API key
            </button>
          </div>
          <button
            className="text-button"
            disabled={!status.password_enabled}
            onClick={() => route("password")}
          >
            Use BHC email and password instead
          </button>
          <p className="help">
            {status.password_enabled
              ? "Requires reconnecting when the token expires, or if your BHC email or password changes."
              : "Password connection is currently unavailable."}
          </p>
          <button className="text-button" onClick={() => route("status")}>
            Maybe later
          </button>
        </>
      ) : (
        <>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => route("choice")}
          >
            ← Connection options
          </button>
          <h3>
            {step === "key"
              ? "Connect using an API key"
              : needsReconnect
                ? "Reconnect with your BHC login"
                : "Connect with your BHC login"}
          </h3>
          {step === "key" && (
            <ol className="bhc-steps">
              <li>
                Open your profile in BHC.
                <p>
                  <a
                    className="button subtle"
                    href="https://app.boathouseconnect.com/profile/myprofile"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open BHC profile
                  </a>
                </p>
              </li>
              <li>Create an API token named Mendocean.</li>
              <li>Copy it and return here.</li>
            </ol>
          )}
          <form onSubmit={(e) => void connect(e)}>
            {step === "key" ? (
              <>
                <label htmlFor={`${id}-token`}>BHC API key</label>
                <div className="bhc-secret">
                  <input
                    id={`${id}-token`}
                    type={show ? "text" : "password"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoComplete="off"
                    required
                    maxLength={200}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShow(!show)}
                    aria-controls={`${id}-token`}
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="help">BHC calls this an API token.</p>
              </>
            ) : (
              <>
                <label>
                  BHC email
                  <input
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    maxLength={254}
                    disabled={busy}
                  />
                </label>
                <label htmlFor={`${id}-password`}>BHC password</label>
                <div className="bhc-secret">
                  <input
                    id={`${id}-password`}
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    maxLength={1024}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShow(!show)}
                    aria-controls={`${id}-password`}
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                </div>
                <p>
                  <a
                    href={BHC_LOGIN_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Forgot your BHC password?
                  </a>
                </p>
                <p className="help">
                  We use your password to connect to BHC and don't save it.
                </p>
                <p className="help">
                  Requires reconnecting when the token expires, or if your BHC email
                  or password changes.
                </p>
              </>
            )}
            <button className="button full" disabled={busy}>
              {busy
                ? "Connecting to BHC…"
                : needsReconnect
                  ? "Reconnect BHC"
                  : "Connect BHC"}
            </button>
          </form>
          <button
            className="text-button"
            disabled={busy || (step === "key" && !status.password_enabled)}
            onClick={() => route(step === "key" ? "password" : "key")}
          >
            {step === "key"
              ? "Use BHC email and password instead"
              : "Use an API key instead"}
          </button>
        </>
      )}
      {problem === "bhc_membership_missing" && (
        <h4>Mendota membership not found</h4>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {problem === "bhc_membership_missing" && (
        <p>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => route("choice")}
          >
            Use a different BHC account
          </button>{" "}
          ·{" "}
          <a href={BHC_LOGIN_URL} target="_blank" rel="noopener noreferrer">
            Check membership in BHC
          </a>
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {delay && (
        <p role="status">
          The import is taking longer than expected. You can keep using
          Mendocean and check back later.
        </p>
      )}
    </section>
  );
}
