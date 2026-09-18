/**
 * One table drives the navigation, the forecast predicate and the resume
 * whitelist, so the three cannot drift apart.
 */
export const DESTINATIONS = [
  { id: "Today", group: "Forecasts" },
  { id: "Week", group: "Forecasts" },
  { id: "Rows", group: "Forecasts" },
  { id: "Log", group: null },
  { id: "My rows", group: null },
] as const;
export type Destination = (typeof DESTINATIONS)[number]["id"];
export const FORECASTS = "Forecasts";
export const DEFAULT_DESTINATION: Destination = "Today";
export const forecastDestinations = DESTINATIONS.filter(
  (d) => d.group === FORECASTS,
).map((d) => d.id);
/** Top-level entries. The forecast group is one entry that opens its default. */
export const topLevel = [
  { id: FORECASTS, opens: DEFAULT_DESTINATION as Destination },
  ...DESTINATIONS.filter((d) => d.group === null).map((d) => ({
    id: d.id as string,
    opens: d.id as Destination,
  })),
];
export function isDestination(value: unknown): value is Destination {
  return DESTINATIONS.some((d) => d.id === value);
}
export function isForecast(value: string): boolean {
  return (forecastDestinations as readonly string[]).includes(value);
}
