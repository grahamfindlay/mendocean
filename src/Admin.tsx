import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ArrowLeft, Menu, X } from "lucide-react";
import type { AccountData } from "./App";
import AdminActivity from "./AdminActivity";
import { AdminOverview, AdminOperations } from "./AdminOperations";
import { AdminIntervals, AdminModels, AdminReconcile } from "./AdminTools";
import { UpdateBanner } from "./UpdateControls";

const pages = [
  {
    path: "/admin",
    label: "Overview",
    description: "Pilot activity and service status at a glance.",
  },
  {
    path: "/admin/accounts",
    label: "Accounts & activity",
    description: "Invite pilot users and review their observed activity.",
  },
  {
    path: "/admin/reconcile",
    label: "Reconcile duplicates",
    description: "Combine records that describe the same event.",
  },
  {
    path: "/admin/intervals",
    label: "Correct actual times",
    description: "Set the agreed time on the water for weather enrichment.",
  },
  {
    path: "/admin/operations",
    label: "Operations",
    description:
      "Weather collection, background jobs, storage, and service monitoring.",
  },
  {
    path: "/admin/models",
    label: "Models",
    description:
      "Review model performance and manage the pilot forecast model.",
  },
];

export default function Admin({
  account,
  signedIn,
  authReady,
  accountError,
  onRetry,
  onSignIn,
  onSignOut,
}: {
  account: AccountData | null;
  signedIn: boolean;
  authReady: boolean;
  accountError: string;
  onRetry: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const allowed = signedIn && account?.profile.role === "admin";
  const page = pages.find((p) => p.path === pathname.replace(/\/$/, ""));
  useEffect(() => {
    setMenuOpen(false);
    if (allowed) heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname, allowed]);
  return (
    <div className="admin-shell">
      <UpdateBanner />
      <header className="admin-header">
        <Link className="admin-brand" to="/admin">
          Mendocean <span>Administration</span>
        </Link>
        <div className="header-actions">
          <Link className="button subtle" to="/">
            <ArrowLeft size={16} />
            Back to Mendocean
          </Link>
          {signedIn && (
            <button className="text-button" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>
      {!authReady || (signedIn && !account && !accountError) ? (
        <main className="admin-access">
          <h1>Administration</h1>
          <p role="status">Loading your account…</p>
        </main>
      ) : !signedIn ? (
        <main className="admin-access">
          <h1>Administration</h1>
          <p>Sign in with your administrator account to continue.</p>
          <button className="button" onClick={onSignIn}>
            Sign in
          </button>
        </main>
      ) : !account ? (
        <main className="admin-access">
          <h1>Administration</h1>
          <p className="alert" role="alert">
            {accountError}
          </p>
          <button className="button subtle" onClick={onRetry}>
            Retry account loading
          </button>
        </main>
      ) : !allowed ? (
        <main className="admin-access">
          <h1>Administrator access required</h1>
          <p>This account does not have access to pilot administration.</p>
          <Link className="button" to="/">
            Return to Mendocean
          </Link>
        </main>
      ) : (
        <div className="admin-layout">
          <aside className="admin-sidebar">
            <button
              className="button subtle admin-menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="admin-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}Menu ·{" "}
              {page?.label || "Administration"}
            </button>
            <nav
              id="admin-navigation"
              className={
                menuOpen ? "admin-navigation open" : "admin-navigation"
              }
              aria-label="Administration"
            >
              {pages.map((p) => (
                <NavLink key={p.path} to={p.path} end>
                  {p.label}
                </NavLink>
              ))}
            </nav>
          </aside>
          <main className="admin-content" id="admin-content">
            <div className="admin-page-heading">
              <p className="eyebrow">PILOT ADMINISTRATION</p>
              <h1 ref={heading} tabIndex={-1}>
                {page?.label || "Page not found"}
              </h1>
              {page && <p>{page.description}</p>}
            </div>
            <Routes>
              <Route path="/admin" element={<AdminOverview />} />
              <Route path="/admin/accounts" element={<AdminActivity />} />
              <Route path="/admin/reconcile" element={<AdminReconcile />} />
              <Route path="/admin/intervals" element={<AdminIntervals />} />
              <Route path="/admin/operations" element={<AdminOperations />} />
              <Route path="/admin/models" element={<AdminModels />} />
              <Route
                path="*"
                element={
                  <p>
                    This administration page does not exist.{" "}
                    <Link to="/admin">Open overview</Link>.
                  </p>
                }
              />
            </Routes>
          </main>
        </div>
      )}
    </div>
  );
}
