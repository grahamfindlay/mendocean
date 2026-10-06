// Defaults to a read-only preview. The server fixes the recipient and delivery window.
const preview = !process.argv.includes("--send");
const clock = Object.fromEntries(
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .map((p) => [p.type, p.value]),
);
if (!preview && (clock.weekday !== "Mon" || clock.hour !== "08")) {
  console.log("Digest skipped outside Monday 8 AM Chicago delivery window.");
  process.exit(0);
}
try {
  const url = new URL(process.env.SUPABASE_URL);
  if (
    url.protocol !== "https:" ||
    !/^[a-z\d]+\.supabase\.co$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Expected a hosted Supabase project origin");
  const token = process.env.OWNER_DIGEST_SECRET;
  const gateway = process.env.SUPABASE_ANON_KEY;
  if (!token || !gateway)
    throw new Error("Digest secret and public gateway key are required");
  const response = await fetch(new URL("/functions/v1/jobs", url), {
    method: "POST",
    headers: {
      apikey: gateway,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "owner-digest", preview }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`Digest request failed (${response.status})`);
  const data = await response.json();
  console.log(
    preview
      ? data.text
      : data.accepted
        ? `Digest accepted for week ${data.week}.`
        : `Digest skipped: ${data.skipped}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Digest failed");
  process.exitCode = 1;
}
