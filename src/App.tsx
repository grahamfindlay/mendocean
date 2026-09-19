import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Download,
  Plus,
  CalendarPlus,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { api, getWeather, previewMode, supabase } from "./client";
import {
  type Coach,
  type Forecast,
  type Outing,
  type Report,
} from "../shared/domain";
import ForecastView, { type ForecastSelection } from "./ForecastView";
import OutingsView from "./OutingsView";
import AttendanceEditor from "./AttendanceEditor";
import { useClock } from "./useClock";
import { canLog, outingPhase, type RowFilters } from "../shared/presentation";
import Logger from "./Logger";
import { Auth, Modal, SettingsForm, PlanForm } from "./Account";
import { discard, flush, pending, type PendingReport } from "./outbox";
import { startAppUpdates } from "./appUpdates";
import { UpdateBanner } from "./UpdateControls";
import {
  DEFAULT_DESTINATION,
  FORECASTS,
  isDestination,
  isForecast,
  topLevel,
  forecastDestinations,
} from "./navigation";
const NO_FILTERS: RowFilters = {
  type: "All",
  attendance: "All",
  reports: "All",
  allPractices: false,
};
const FILTER_OPTIONS = {
  type: ["All", "Practices", "Independent"],
  attendance: ["All", "Attending", "Unknown", "Not attending"],
  reports: ["All", "Unlogged", "Logged"],
} as const;
/** Anything unrecognized in a restored position falls back to unfiltered. */
function savedFilters(value: any): RowFilters {
  const pick = (key: keyof typeof FILTER_OPTIONS) =>
    (FILTER_OPTIONS[key] as readonly string[]).includes(value?.[key])
      ? value[key]
      : "All";
  return {
    type: pick("type"),
    attendance: pick("attendance"),
    reports: pick("reports"),
    allPractices: value?.allPractices === true,
  };
}
function readUpdatePosition() {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem("mendocean-update-position") || "null",
    );
    sessionStorage.removeItem("mendocean-update-position");
    return saved && Date.now() - saved.at < 300000 && isDestination(saved.tab)
      ? saved
      : null;
  } catch {
    return null;
  }
}
export interface AccountData {
  push_devices?: number;
  outings: Outing[];
  coaches: Coach[];
  profile: {
    display_name: string;
    role: string;
    reminder_channel: string;
    reminder_channels?: string[];
    reminders_paused: boolean;
  };
  bhc: {
    connected: boolean;
    last_sync: string | null;
    last_error: string | null;
  };
}
export default function App() {
  const now = useClock();
  const [resume] = useState(readUpdatePosition);
  const [outingView, setOutingView] = useState<"Upcoming" | "Past">("Upcoming");
  const [rowFilters, setRowFilters] = useState<RowFilters>(NO_FILTERS);
  const [forecastSelection, setForecastSelection] =
    useState<ForecastSelection>();
  const weatherRequest = useRef<Promise<void> | null>(null);
  const weatherFetchedAt = useRef(0);
  const [tab, setTab] = useState(
    resume?.tab ||
      (new URLSearchParams(location.search).has("log")
        ? "Log"
        : isDestination(new URLSearchParams(location.search).get("tab"))
          ? new URLSearchParams(location.search).get("tab")!
          : DEFAULT_DESTINATION),
  );
  const [weather, setWeather] = useState<Forecast | null>(null);
  const [weatherError, setWeatherError] = useState("");
  const currentUser = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [settings, setSettings] = useState(
    new URLSearchParams(location.search).has("account"),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<PendingReport[]>([]);
  const [editing, setEditing] = useState<{ outing: Outing; report: Report }>();
  const [planned, setPlanned] = useState(false);
  const [attendanceOuting, setAttendanceOuting] = useState<Outing>();
  const [selectedOuting, setSelectedOuting] = useState<string | undefined>(
    new URLSearchParams(location.search).get("log") || undefined,
  );
  const updatePosition = useRef({});
  updatePosition.current = {
    tab,
    outingView,
    rowFilters,
    forecastSelection,
    selectedOuting,
    userId: user?.id,
    at: now,
  };
  useEffect(
    () =>
      startAppUpdates(() => {
        sessionStorage.setItem(
          "mendocean-update-position",
          JSON.stringify(updatePosition.current),
        );
      }),
    [],
  );
  const refreshWeather = useCallback(() => {
    if (weatherRequest.current) return weatherRequest.current;
    setWeatherError("");
    weatherRequest.current = getWeather()
      .then((data) => {
        weatherFetchedAt.current = Date.parse(data.fetched_at);
        setWeather(data);
      })
      .catch((e) => setWeatherError(e.message))
      .finally(() => {
        weatherRequest.current = null;
      });
    return weatherRequest.current;
  }, []);
  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      // Device-saved reports remain visible even when the account API is offline.
      const items = await pending(user.id);
      if (currentUser.current !== user.id) return;
      setQueue(items);
      if (!navigator.onLine) return;
      const data = await api<AccountData>("account", undefined, user.id);
      if (currentUser.current !== user.id) return;
      setAccount(data);
    } catch (e) {
      if (currentUser.current === user.id) setError((e as Error).message);
    }
  }, [user]);
  useEffect(() => {
    refreshWeather();
    const timer = setInterval(refreshWeather, 5 * 60000);
    const onReturn = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - weatherFetchedAt.current >= 15 * 60000
      )
        void refreshWeather();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [refreshWeather]);
  useEffect(() => {
    if (previewMode) {
      currentUser.current = "10000000-0000-4000-8000-000000000001";
      setUser({
        id: "10000000-0000-4000-8000-000000000001",
        email: "sample@example.test",
      } as User);
      return;
    }
    if (!supabase) return;
    const updateUser = (next: User | null) => {
      if (currentUser.current !== next?.id) {
        setAccount(null);
        setQueue([]);
        setEditing(undefined);
        setSettings(
          !!next && new URLSearchParams(location.search).has("account"),
        );
        setPlanned(false);
        setForecastSelection(undefined);
        setOutingView("Upcoming");
        setRowFilters(NO_FILTERS);
        if (
          resume &&
          next &&
          !currentUser.current &&
          resume.userId === next.id
        ) {
          setOutingView(resume.outingView === "Past" ? "Past" : "Upcoming");
          setRowFilters(savedFilters(resume.rowFilters));
          setForecastSelection(resume.forecastSelection);
          setSelectedOuting(resume.selectedOuting);
        }
      }
      currentUser.current = next?.id ?? null;
      setUser(next);
    };
    void supabase.auth
      .getSession()
      .then(({ data }) => updateUser(data.session?.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      updateUser(session?.user ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const o = account?.outings.find((o) => o.id === selectedOuting);
    if (o?.reports?.[0]) setEditing({ outing: o, report: o.reports[0] });
  }, [account, selectedOuting]);
  useEffect(() => {
    if (!user) return;
    const online = () => {
      void flush(user.id).then(() => refresh());
    };
    if (navigator.onLine) online();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [user, refresh]);
  useEffect(() => {
    const share = new URLSearchParams(location.search).get("join");
    if (!share || !user) return;
    void api("join", { token: share })
      .then(() => {
        history.replaceState({}, "", location.pathname);
        setMessage("You joined the shared row.");
        setTab("My rows");
        void refresh();
      })
      .catch((e) => setError(e.message));
  }, [user, refresh]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  function navigate(name: string) {
    setEditing(undefined);
    setSelectedOuting(undefined);
    setTab(name);
    setError("");
  }
  return (
    <div className="app-shell">
      <UpdateBanner />
      <header className="site-header">
        <a className="wordmark" href="/">
          mendocean<span>LAKE MENDOTA / MADISON, WI</span>
        </a>
        {user ? (
          <button className="button subtle" onClick={() => setSettings(true)}>
            <Settings size={16} />
            Account
          </button>
        ) : (
          <button className="button subtle" onClick={() => setAuthOpen(true)}>
            Sign in <ArrowUpRight size={16} />
          </button>
        )}
      </header>
      <nav className="main-nav" aria-label="Main navigation">
        {topLevel.map(({ id, opens }) => (
          <button
            key={id}
            aria-current={
              (id === FORECASTS ? isForecast(tab) : tab === id)
                ? "page"
                : undefined
            }
            className={
              (id === FORECASTS ? isForecast(tab) : tab === id)
                ? "selected"
                : ""
            }
            onClick={() => navigate(opens)}
          >
            {id === "Log" && <Plus size={16} />} {id}
          </button>
        ))}
      </nav>
      {/* Kept mounted and hidden rather than unmounted: toggling this row
          between destinations destabilises the tree below it. */}
      <nav className="sub-nav" aria-label="Forecasts" hidden={!isForecast(tab)}>
        {forecastDestinations.map((name) => (
          <button
            key={name}
            aria-current={tab === name ? "page" : undefined}
            className={tab === name ? "selected" : ""}
            onClick={() => navigate(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      {!supabase && (
        <div className="setup-note">
          {previewMode
            ? "Sample account · Reports in this preview are stored only on this device."
            : "Local preview · Account services are waiting for Supabase setup."}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          <Check size={17} />
          <span>{message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setMessage("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <main>
        {isForecast(tab) ? (
          weather ? (
            <ForecastView
              now={now}
              selection={forecastSelection}
              userId={user?.id}
              weather={weather}
              tab={tab}
              outings={account?.outings || []}
              onLog={() => navigate("Log")}
              onSchedule={() => setPlanned(true)}
            />
          ) : (
            <section className="empty-state">
              <h1>
                {weatherError
                  ? "Weather is unavailable."
                  : "Checking the wind…"}
              </h1>
              <p>
                {weatherError ||
                  "Getting the latest conditions at James Madison Park."}
              </p>
              {weatherError && (
                <button className="button" onClick={refreshWeather}>
                  <RefreshCw size={16} />
                  Try again
                </button>
              )}
            </section>
          )
        ) : !user ? (
          <section className="empty-state">
            <p className="eyebrow">A SMALL EFFORT. A BETTER FORECAST.</p>
            <h1>Log a row</h1>
            <p>Sign in to log practices and independent rows.</p>
            <button className="button" onClick={() => setAuthOpen(true)}>
              Sign in to log <ArrowUpRight size={16} />
            </button>
            <p className="help">The pilot is invitation-only.</p>
          </section>
        ) : tab === "Log" ? (
          <Logger
            key={
              (account ? "ready:" : "loading:") +
              (editing?.report.id || selectedOuting || "new")
            }
            user={user.id}
            outings={account?.outings || []}
            coaches={account?.coaches || []}
            editing={editing}
            initialOuting={
              account?.outings.some(
                (o) => o.id === selectedOuting && canLog(o, now),
              )
                ? selectedOuting
                : undefined
            }
            onSaved={(m) => {
              setMessage(
                previewMode ? "Sample report saved only on this device." : m,
              );
              if (!editing) {
                const saved = account?.outings.find(
                  (o) => o.id === selectedOuting,
                );
                setOutingView(
                  saved && outingPhase(saved, Date.now()) !== "past"
                    ? "Upcoming"
                    : "Past",
                );
                setRowFilters(NO_FILTERS);
              }
              setEditing(undefined);
              setSelectedOuting(undefined);
              setTab("My rows");
              void refresh();
            }}
          />
        ) : (
          <>
            <div className="page-heading">
              <div>
                <h1>My rows</h1>
              </div>
              {/* Both entries are explicit: "Log" alone reads as recording
                  something that already happened, which left scheduling
                  discoverable only by accident. */}
              <div className="heading-actions">
                <button
                  className="button subtle"
                  onClick={() => setPlanned(true)}
                >
                  <CalendarPlus size={16} />
                  Schedule independent row
                </button>
                <button
                  className="button subtle"
                  onClick={() => {
                    setEditing(undefined);
                    setSelectedOuting(undefined);
                    setTab("Log");
                  }}
                >
                  <Plus size={16} />
                  Log independent row
                </button>
              </div>
            </div>
            {!!queue.length && (
              <section className="form-card">
                <h2>On this device · {queue.length} pending</h2>
                <p>These reports have not reached the server.</p>
                {queue.map((q) => (
                  <div className="queue-row" key={q.key}>
                    <div>
                      <b>{q.outing.title}</b>
                      <p>{q.error || "Waiting for a connection."}</p>
                    </div>
                    <button
                      className="button subtle"
                      onClick={() =>
                        void act(async () => {
                          if (
                            confirm(
                              "Discard this unsent report from this device?",
                            )
                          ) {
                            await discard(q.key);
                            await refresh();
                          }
                        })
                      }
                    >
                      Discard
                    </button>
                  </div>
                ))}
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await flush(user.id);
                      await refresh();
                    })
                  }
                >
                  Retry upload
                </button>
              </section>
            )}
            <div className="toolbar">
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    download(
                      "mendocean-my-data.json",
                      JSON.stringify(await api("export"), null, 2),
                    );
                  })
                }
              >
                <Download size={16} />
                Export my data
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void act(refresh)}
              >
                <RefreshCw size={15} />
                Refresh
              </button>
            </div>
            {account ? (
              <OutingsView
                outings={account.outings}
                queued={queue.map((q) => q.outing.id)}
                profile={account.profile}
                bhcConnected={account.bhc.connected}
                onAttendance={setAttendanceOuting}
                now={now}
                user={user.id}
                weather={weather}
                view={outingView}
                filters={rowFilters}
                onView={setOutingView}
                onFilters={setRowFilters}
                busy={busy}
                onSettings={() => setSettings(true)}
                onLog={(o) => {
                  setSelectedOuting(o.id);
                  setTab("Log");
                }}
                onEdit={(outing, report) => {
                  setEditing({ outing, report });
                  setTab("Log");
                }}
                onForecast={(o) => {
                  setForecastSelection({
                    id: o.id,
                    starts_at: o.starts_at,
                    ends_at: o.ends_at,
                  });
                  setTab("Rows");
                }}
                onDelete={(report) =>
                  void act(async () => {
                    if (
                      confirm(
                        "Delete your report? Other people’s reports will stay.",
                      )
                    ) {
                      await api("report/delete", {
                        id: report.id,
                        version: report.version,
                      });
                      await refresh();
                    }
                  })
                }
                onShare={(o) =>
                  void act(async () => {
                    const result = await api<{ url: string }>("share", {
                      outing_id: o.id,
                    });
                    await navigator.clipboard.writeText(result.url);
                    setMessage(
                      "Invitation link copied. It expires in seven days and requires an invited account.",
                    );
                  })
                }
                onReminder={(o, action) =>
                  void act(async () => {
                    await api("reminder", { outing_id: o.id, action });
                    setMessage(
                      action === "skip"
                        ? "Logging reminder turned off."
                        : action === "snooze"
                          ? "Logging reminder scheduled for one hour from now."
                          : "Logging reminder enabled.",
                    );
                    await refresh();
                  })
                }
              />
            ) : (
              <p role="status">Loading your rows…</p>
            )}
          </>
        )}
      </main>
      <footer>
        <span>
          Inspired by{" "}
          <a href="https://hwaymentsteele.github.io/mendota-weather/">
            Hannah’s Mendota forecast
          </a>
          .
        </span>
        <span>Conditions inform your judgment. They don’t replace it.</span>
      </footer>
      {authOpen && (
        <Auth
          onClose={() => setAuthOpen(false)}
          onSuccess={() => {
            setAuthOpen(false);
            setMessage("You’re signed in.");
          }}
        />
      )}
      {attendanceOuting && user && (
        <AttendanceEditor
          key={user.id + attendanceOuting.id}
          outing={attendanceOuting}
          user={user.id}
          now={now}
          onClose={() => setAttendanceOuting(undefined)}
          onRefresh={refresh}
        />
      )}
      {settings && user && (
        <Modal title="Your account" onClose={() => setSettings(false)}>
          <SettingsForm
            account={account}
            onUpdated={() => void refresh()}
            onSignOut={() =>
              void act(async () => {
                await supabase?.auth.signOut();
                setTab(DEFAULT_DESTINATION);
              })
            }
          />
        </Modal>
      )}
      {planned && (
        <Modal
          title="Schedule independent row"
          onClose={() => setPlanned(false)}
        >
          <PlanForm
            onSave={async (body) => {
              await api("outing", body);
              setPlanned(false);
              setOutingView("Upcoming");
              setMessage("Independent row added.");
              await refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
function download(name: string, contents: string) {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
