import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
if (window.location.hostname === "mendocean.pages.dev") {
  const destination = new URL(window.location.href);
  destination.hostname = "mendocean.fyi";
  window.location.replace(destination.href);
} else
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
