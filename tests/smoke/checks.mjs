export function validateForecast(forecast, now = Date.now()) {
  if (!Array.isArray(forecast?.hours) || !forecast.hours.length)
    throw new Error("forecast-schema: missing hours");
  const age = now - Date.parse(forecast.fetched_at);
  if (!Number.isFinite(age) || age < -300000 || age > 90 * 60000)
    throw new Error(
      "weather-freshness: forecast is older than 90 minutes or has an invalid timestamp",
    );
  const future = forecast.hours.filter(
    (h) =>
      Date.parse(h.time) >= now &&
      Number.isFinite(h.wind) &&
      Number.isFinite(h.direction),
  );
  if (
    !future.length ||
    !future.some((h) => Date.parse(h.time) >= now + 4 * 86400000)
  )
    throw new Error("forecast-coverage: insufficient valid future hours");
}
export function requireDenied(status) {
  if (status !== 401 && status !== 403)
    throw new Error("authorization: unsigned request was not rejected");
}
export function validateAuth(settings) {
  if (settings.external?.email !== true || settings.disable_signup !== true)
    throw new Error("auth-configuration: expected invited email login only");
}
