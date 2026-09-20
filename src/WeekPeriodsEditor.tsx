import { useState } from "react";
import {
  ALL_WEEKDAYS,
  WEEKDAY_NAMES,
  periodDaysLabel,
  sortPeriods,
  weekPeriodSchema,
  type WeekPeriod,
} from "../shared/weekPeriods";
import type { useWeekPeriods } from "./useWeekPeriods";

function clockLabel(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

const dayPresets = [
  { label: "Every day", days: ALL_WEEKDAYS },
  { label: "Weekdays", days: [0, 1, 2, 3, 4] },
  { label: "Weekends", days: [5, 6] },
];

export default function WeekPeriodsEditor({
  preferences,
}: {
  preferences: ReturnType<typeof useWeekPeriods>;
}) {
  const { periods, loading, ready, saving, error, save, retry } = preferences;
  const [draft, setDraft] = useState<WeekPeriod | null>(null);
  const [validation, setValidation] = useState("");
  function edit(period: WeekPeriod) {
    setDraft({ ...period });
    setValidation("");
  }
  return (
    <details className="week-periods">
      <summary>Times of interest</summary>
      <p>All times are in Madison time.</p>
      {loading && <p role="status">Loading your periods…</p>}
      {error && <p role="alert">{error}</p>}
      {!ready && !loading && (
        <button type="button" onClick={retry}>
          Retry
        </button>
      )}
      <fieldset disabled={!ready || saving}>
        <legend className="sr-only">Periods shown on Week cards</legend>
        {sortPeriods(periods).map((period) => (
          <div className="week-period-choice" key={period.id}>
            <label>
              <input
                type="checkbox"
                aria-label={period.label}
                disabled={!!draft}
                checked={period.enabled}
                onChange={(e) =>
                  void save(
                    periods.map((p) =>
                      p.id === period.id
                        ? { ...p, enabled: e.target.checked }
                        : p,
                    ),
                  )
                }
              />
              <span>
                {period.label}
                <small className="week-period-range">
                  {clockLabel(period.start)} – {clockLabel(period.end)}
                  <span className="week-period-days-summary">
                    {periodDaysLabel(period.days)}
                  </span>
                </small>
              </span>
            </label>
            <button
              type="button"
              className="text-button"
              disabled={!!draft}
              aria-label={`Edit ${period.label}`}
              onClick={() => edit(period)}
            >
              Edit
            </button>
            <button
              type="button"
              className="text-button"
              disabled={!!draft}
              aria-label={`Remove ${period.label}`}
              onClick={async () => {
                if (await save(periods.filter((p) => p.id !== period.id))) {
                  if (draft?.id === period.id) setDraft(null);
                }
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {!draft && (
          <button
            type="button"
            disabled={periods.length >= 12}
            onClick={() =>
              edit({
                id: crypto.randomUUID(),
                label: "",
                start: "09:00",
                end: "11:00",
                enabled: true,
                days: [...ALL_WEEKDAYS],
              })
            }
          >
            Add period
          </button>
        )}
        {draft && (
          <form
            className="week-period-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = weekPeriodSchema.safeParse(draft);
              if (!result.success) {
                setValidation(result.error.issues[0].message);
                return;
              }
              const next = periods.some((p) => p.id === draft.id)
                ? periods.map((p) => (p.id === draft.id ? result.data : p))
                : [...periods, result.data];
              if (await save(next)) setDraft(null);
            }}
          >
            <h3>
              {periods.some((p) => p.id === draft.id)
                ? "Edit period"
                : "Add period"}
            </h3>
            <label>
              Period name
              <input
                value={draft.label}
                maxLength={40}
                required
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                autoFocus
              />
            </label>
            <div className="week-period-times">
              <label>
                Start time
                <input
                  type="time"
                  required
                  value={draft.start}
                  onChange={(e) =>
                    setDraft({ ...draft, start: e.target.value })
                  }
                />
              </label>
              <label>
                End time
                <input
                  type="time"
                  required
                  value={draft.end}
                  onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                />
              </label>
            </div>
            <fieldset className="week-repeat">
              <legend>Repeat on</legend>
              <div className="week-day-presets">
                {dayPresets.map(({ label, days }) => (
                  <button
                    type="button"
                    key={label}
                    aria-pressed={draft.days.join() === days.join()}
                    onClick={() => {
                      setDraft({ ...draft, days: [...days] });
                      setValidation("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="week-day-buttons">
                {WEEKDAY_NAMES.map((name, index) => (
                  <button
                    type="button"
                    key={name}
                    aria-label={name}
                    aria-pressed={draft.days.includes(index)}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        days: draft.days.includes(index)
                          ? draft.days.filter((d) => d !== index)
                          : [...draft.days, index].sort(),
                      });
                      setValidation("");
                    }}
                  >
                    {name[0]}
                  </button>
                ))}
              </div>
            </fieldset>
            {validation && <p role="alert">{validation}</p>}
            <div className="week-period-actions">
              <button type="submit">Save period</button>
              <button type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </fieldset>
      {saving && <p role="status">Saving…</p>}
    </details>
  );
}
