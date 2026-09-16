export function pushEnvironment() {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone;
  const supported =
    "PushManager" in window &&
    "Notification" in window &&
    "serviceWorker" in navigator;
  const permission =
    "Notification" in window ? Notification.permission || "default" : "default";
  return { ios, installed, supported, permission };
}
