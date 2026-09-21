import { useEffect, useRef, useState } from "react";
import "./LakeCamera.css";

const original = "http://144.92.62.155/popup.html?0";
export default function LakeCamera() {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);
  const [frame, setFrame] = useState<{ url: string; fetched: string }>();
  const [error, setError] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const currentURL = useRef<string | undefined>(undefined);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    if (panel.current) observer.observe(panel.current);
    const changed = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", changed);
    };
  }, []);
  useEffect(
    () => () => {
      if (currentURL.current) URL.revokeObjectURL(currentURL.current);
    },
    [],
  );
  useEffect(() => {
    if (!open) {
      if (currentURL.current) URL.revokeObjectURL(currentURL.current);
      currentURL.current = undefined;
      setFrame(undefined);
      setError(false);
      return;
    }
    if (!visible || !foreground) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const controller = new AbortController();
    async function next() {
      const started = performance.now();
      let pendingURL: string | undefined;
      try {
        const response = await fetch("/api/lake-camera.jpg", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.startsWith("image/jpeg")
        )
          throw new Error("Camera unavailable");
        pendingURL = URL.createObjectURL(await response.blob());
        const image = new Image();
        image.src = pendingURL;
        await image.decode();
        if (stopped) return;
        const previous = currentURL.current;
        currentURL.current = pendingURL;
        setFrame({
          url: pendingURL,
          fetched:
            response.headers.get("X-Camera-Fetched-At") ||
            new Date().toISOString(),
        });
        pendingURL = undefined;
        if (previous) URL.revokeObjectURL(previous);
        failures = 0;
        setError(false);
      } catch {
        if (!stopped) {
          failures++;
          setError(true);
        }
      } finally {
        if (pendingURL) URL.revokeObjectURL(pendingURL);
        if (!stopped)
          timer = setTimeout(
            next,
            failures
              ? Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4))
              : Math.max(0, 1000 - (performance.now() - started)),
          );
      }
    }
    void next();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, visible, foreground]);
  return (
    <div className="lake-camera" ref={panel}>
      <div className="lake-camera-actions">
        <button
          className="button subtle"
          type="button"
          aria-expanded={open}
          aria-controls="lake-camera-view"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide camera" : "Show lake camera"}
        </button>
        <a href={original} target="_blank" rel="noreferrer">
          Open webcam ↗
        </a>
      </div>
      {open && (
        <div id="lake-camera-view">
          <div className="lake-camera-image">
            {frame ? (
              <img
                src={frame.url}
                alt="Lake Mendota from the UW–Madison Center for Limnology"
                width="1024"
                height="768"
              />
            ) : (
              <p>
                {error
                  ? "Camera temporarily unavailable."
                  : "Loading lake camera…"}
              </p>
            )}
          </div>
          <p className="lake-camera-caption">
            UW–Madison Center for Limnology · Updates up to once per second
            {frame && (
              <> · Fetched {new Date(frame.fetched).toLocaleTimeString()}</>
            )}
          </p>
          {error && (
            <p role="status">
              Camera connection interrupted. Retrying… You can also open the
              webcam above.
            </p>
          )}
          {(!visible || !foreground) && <p>Camera paused.</p>}
        </div>
      )}
    </div>
  );
}
