import { Component, type ReactNode } from "react";
import { captureFailure } from "./telemetry";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    captureFailure(error, "render");
  }
  render() {
    return this.state.failed ? (
      <main className="app-shell">
        <h1>Mendocean could not open this view</h1>
        <p>Your saved reports remain on this device. Reload to try again.</p>
        <button className="button" onClick={() => location.reload()}>
          Reload
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
