// Development-only direct component harness; never imported by the application.
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import Admin from "../../src/Admin";
import "../../src/styles.css";
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Admin
      account={{
        outings: [],
        coaches: [],
        profile: {
          id: "admin-fixture",
          display_name: "Admin",
          role: "admin",
          reminder_channel: "none",
          reminders_paused: false,
        },
        bhc: { connected: false, last_sync: null, last_error: null },
      }}
      signedIn
      authReady
      accountError=""
      onRetry={() => {}}
      onSignIn={() => {}}
      onSignOut={() => {}}
    />
  </BrowserRouter>,
);
