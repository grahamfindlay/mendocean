// Dedicated setup key: dashboard/insight read + write and query read, one project only.
const host = process.env.POSTHOG_API_HOST || "https://us.posthog.com";
const project = process.env.POSTHOG_PROJECT_ID;
const owners = (process.env.POSTHOG_OWNER_IDS || "").split(",").filter(Boolean);
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
async function api(path, method = "GET", body) {
  const response = await fetch(`${host}/api/projects/${project}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.POSTHOG_SETUP_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`PostHog setup failed (${response.status})`);
  return response.json();
}
async function list(path) {
  const results = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const data = await api(`${path}?limit=100&offset=${offset}${path === "/insights/" ? "&include_dashboards=true" : ""}`);
    results.push(...data.results);
    if (!data.next) return results;
  }
  throw new Error("Refused incomplete PostHog inventory");
}
try {
  if (
    !["https://us.posthog.com", "https://eu.posthog.com"].includes(host) ||
    !/^\d+$/.test(project || "") ||
    !owners.length ||
    owners.some((id) => !uuid.test(id))
  )
    throw new Error(
      "Set PostHog project ID, supported host, and comma-separated owner UUIDs",
    );
  const exclude = `distinct_id NOT IN (${owners.map((id) => `'${id}'`).join(",")})`;
  const signed = `properties.signed_in = true AND ${exclude}`;
  const definitions = [
    {
      name: "Mendocean \u00b7 Weekly signed-in users",
      description:
        "Observed signed-in people each calendar week. Owner excluded. Browser events may be missing offline; Supabase activity is authoritative.",
      query: {
        kind: "InsightVizNode",
        source: {
          kind: "TrendsQuery",
          series: [
            {
              kind: "EventsNode",
              math: "dau",
              custom_name: "Observed users",
            },
          ],
          interval: "week",
          dateRange: {
            date_from: "-90d",
          },
          properties: [
            {
              type: "hogql",
              key: "event IN ('app_opened','view_opened','report_save_confirmed') AND properties.signed_in = true AND __OWNER_EXCLUSION__",
            },
          ],
          trendsFilter: {
            display: "ActionsLineGraph",
          },
        },
      },
    },
    {
      name: "Mendocean \u00b7 Consecutive-week users",
      description:
        "Observed signed-in people active in both a calendar week and its predecessor. Owner excluded. Derived from the explicit app event contract; collection has not started.",
      query: {
        kind: "DataVisualizationNode",
        display: "ActionsTable",
        source: {
          kind: "HogQLQuery",
          query:
            "WITH active AS (SELECT DISTINCT toStartOfWeek(timestamp,1) AS week, person_id FROM events WHERE timestamp >= now()-INTERVAL 90 DAY AND event IN ('app_opened','view_opened','report_save_confirmed') AND properties.signed_in = true AND __OWNER_EXCLUSION__) SELECT a.week, count(DISTINCT a.person_id) AS returning_users FROM active a INNER JOIN active b ON a.person_id=b.person_id AND b.week=a.week-INTERVAL 7 DAY GROUP BY a.week ORDER BY a.week DESC LIMIT 20",
        },
      },
    },
    {
      name: "Mendocean \u00b7 Forecast destinations",
      description:
        "Observed views of Today, Week and Rows, split by sign-in state. Owner excluded. Analytics has not been activated yet.",
      query: {
        kind: "InsightVizNode",
        source: {
          kind: "TrendsQuery",
          series: [
            {
              kind: "EventsNode",
              event: "view_opened",
              math: "total",
            },
          ],
          interval: "day",
          dateRange: {
            date_from: "-30d",
          },
          properties: [
            {
              type: "hogql",
              key: "properties.screen IN ('Today','Week','Rows') AND __OWNER_EXCLUSION__",
            },
          ],
          breakdownFilter: {
            breakdowns: [
              {
                property: "screen",
                type: "event",
              },
              {
                property: "signed_in",
                type: "event",
              },
            ],
          },
          trendsFilter: {
            display: "ActionsBarValue",
            showLegend: true,
          },
        },
      },
    },
    {
      name: "Mendocean \u00b7 Report start to confirmed save",
      description:
        "Observed people who start a report and confirm a save within seven days, allowing intervening events. Owner excluded. Offline/missing events make this incomplete; Supabase report counts are authoritative.",
      query: {
        kind: "InsightVizNode",
        source: {
          kind: "FunnelsQuery",
          series: [
            {
              kind: "EventsNode",
              event: "report_started",
            },
            {
              kind: "EventsNode",
              event: "report_save_confirmed",
            },
          ],
          dateRange: {
            date_from: "-30d",
          },
          properties: [
            {
              type: "hogql",
              key: "properties.signed_in = true AND __OWNER_EXCLUSION__",
            },
          ],
          funnelsFilter: {
            funnelOrderType: "ordered",
            funnelVizType: "steps",
            funnelWindowInterval: 7,
            funnelWindowIntervalUnit: "day",
          },
        },
      },
    },
    {
      name: "Mendocean \u00b7 Errors by build",
      description:
        "Sanitized exceptions and observed affected people by deployed build over 30 days. Owner excluded. Error collection is not activated yet.",
      query: {
        kind: "InsightVizNode",
        source: {
          kind: "TrendsQuery",
          series: [
            {
              kind: "EventsNode",
              event: "$exception",
              math: "total",
              custom_name: "Exceptions",
            },
            {
              kind: "EventsNode",
              event: "$exception",
              math: "dau",
              custom_name: "Affected people",
            },
          ],
          dateRange: {
            date_from: "-30d",
          },
          properties: [
            {
              type: "hogql",
              key: "__OWNER_EXCLUSION__",
            },
          ],
          breakdownFilter: {
            breakdowns: [
              {
                property: "build",
                type: "event",
              },
            ],
          },
          trendsFilter: {
            display: "ActionsTable",
            showLegend: true,
          },
        },
      },
    },
  ];
  const insights = JSON.parse(
    JSON.stringify(definitions).replaceAll("__OWNER_EXCLUSION__", exclude),
  );
  if (!process.argv.includes("--apply")) {
    console.log(
      JSON.stringify(
        {
          name: "Mendocean beta usage",
          description:
            "Owner excluded. Observed activity; Supabase is authoritative for reports. Set project timezone to America/Chicago.",
          insights,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  if (!process.env.POSTHOG_SETUP_KEY)
    throw new Error("POSTHOG_SETUP_KEY is required for --apply");
  // Validate every query before making dashboard mutations.
  for (const insight of insights)
    await api("/query/", "POST", { query: insight.query.source });
  const dashboards = (await list("/dashboards/")).filter(
    (d) => d.name === "Mendocean beta usage" && !d.deleted,
  );
  if (dashboards.length > 1)
    throw new Error("Duplicate Mendocean dashboards require reconciliation");
  const dashboard =
    dashboards[0] ||
    (await api("/dashboards/", "POST", {
      name: "Mendocean beta usage",
      description:
        "Observed usage, owner excluded. Supabase report counts are authoritative; browser events may be absent offline.",
      pinned: true,
    }));
  const existing = await list("/insights/");
  for (const insight of insights) {
    const matches = existing.filter(
      (i) => i.name === insight.name && !i.deleted,
    );
    if (matches.length > 1)
      throw new Error("Duplicate managed insight names require reconciliation");
    await api(
      matches.length ? `/insights/${matches[0].id}/` : "/insights/",
      matches.length ? "PATCH" : "POST",
      {
        ...insight,
        dashboards: [
          ...new Set([...(matches[0]?.dashboards || []), dashboard.id]),
        ],
        saved: true,
      },
    );
    console.log(`${insight.name}: configured.`);
  }
  console.log(
    `Dashboard: ${host}/project/${project}/dashboard/${dashboard.id}`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "PostHog setup failed",
  );
  process.exitCode = 1;
}
