// Reuses monitors by exact managed name + URL. Starts paused until live baseline checks pass.
const base = "https://incidents.betterstack.com/api/v2";
const required = (name) => {
  if (!process.env[name]) throw new Error(`${name} is required`);
  return process.env[name];
};
async function api(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${required("BETTERSTACK_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Better Stack configuration failed (${response.status})`);
  return response.json();
}
async function all() {
  const items = [];
  for (let page = 1; page <= 100; page++) {
    const data = await api(`/monitors?page=${page}`);
    items.push(...data.data);
    if (!data.pagination?.next) return items;
  }
  throw new Error("Too many monitor pages; refused partial inventory");
}
try {
  const project = new URL(required("SUPABASE_URL"));
  if (
    project.protocol !== "https:" ||
    !/^[a-z\d]+\.supabase\.co$/.test(project.hostname) ||
    project.username ||
    project.password ||
    project.pathname !== "/" ||
    project.search ||
    project.hash
  )
    throw new Error("Expected a hosted Supabase project origin");
  const monitorSecret = required("MONITOR_SECRET"),
    gateway = required("SUPABASE_ANON_KEY");
  const monitors = [
    {
      pronounceable_name: "Mendocean frontend",
      url: "https://mendocean.fyi/",
      request_headers: [],
      monitor_type: "keyword",
      required_keyword: 'id="root"',
    },
    {
      pronounceable_name: "Mendocean service readiness",
      url: new URL("/functions/v1/api/monitor/ready", project).href,
      request_headers: [
        { name: "Authorization", value: `Bearer ${monitorSecret}` },
        { name: "apikey", value: gateway },
      ],
      monitor_type: "expected_status_code",
      expected_status_codes: [200],
    },
  ];
  if (!process.argv.includes("--apply")) {
    console.log(
      "Will create or update two PAUSED monitors: frontend and private service readiness. Use --apply with provider credentials to configure.",
    );
    process.exit(0);
  }
  const existing = await all();
  for (const monitor of monitors) {
    const matches = existing.filter(
      (m) =>
        m.attributes.pronounceable_name === monitor.pronounceable_name &&
        m.attributes.url === monitor.url,
    );
    if (matches.length > 1)
      throw new Error(
        "Duplicate managed monitors require manual reconciliation",
      );
    const body = {
      ...monitor,
      check_frequency: 300,
      confirmation_period: 600,
      recovery_period: 300,
      request_timeout: 15,
      http_method: "GET",
      verify_ssl: true,
      follow_redirects: false,
      email: true,
      // Route to the verified Mendocean team even when its on-call schedule is empty.
      team_wait: 0,
      sms: false,
      call: false,
      push: false,
      paused: true,
      ...(process.env.BETTERSTACK_TEAM_NAME
        ? { team_name: process.env.BETTERSTACK_TEAM_NAME }
        : {}),
    };
    await api(
      matches.length ? `/monitors/${matches[0].id}` : "/monitors",
      matches.length ? "PATCH" : "POST",
      body,
    );
    console.log(
      `${monitor.pronounceable_name}: configured and paused. Resume after healthy baseline and recipient checks.`,
    );
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Monitor setup failed",
  );
  process.exitCode = 1;
}
