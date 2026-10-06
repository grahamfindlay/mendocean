// Called only after encrypted artifact upload succeeded. Never print the heartbeat token.
const configured = process.env.BACKUP_HEARTBEAT_URL;
if (!configured) {
  console.log("Backup heartbeat not configured.");
  process.exit(0);
}
try {
  const url = new URL(configured);
  if (
    url.protocol !== "https:" ||
    !["incidents.betterstack.com", "uptime.betterstack.com"].includes(
      url.hostname,
    ) ||
    !/^\/api\/v1\/heartbeat\/[\w-]+$/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid backup heartbeat configuration");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Backup heartbeat rejected");
  console.log("Backup completion heartbeat accepted.");
} catch {
  console.error(
    "Backup artifact was uploaded, but the completion heartbeat failed.",
  );
  process.exitCode = 1;
}
