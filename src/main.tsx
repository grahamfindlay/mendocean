import React from "react";
import { BrowserRouter } from "react-router-dom";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { initializeTelemetry } from "./telemetry";
import "./styles.css";
if (window.location.hostname === "mendocean.pages.dev") {
  const destination = new URL(window.location.href);
  destination.hostname = "mendocean.fyi";
  window.location.replace(destination.href);
} else
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>,
  );
if (window.location.hostname !== "mendocean.pages.dev")
  void initializeTelemetry();
