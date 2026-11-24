// Sprint mode threshold: how many days before the deadline the plan switches
// to a compressed schedule. The user sets it; the default is 7 days.

const KEY = 'trailpack.sprintDays';
export const DEFAULT_SPRINT_DAYS = 7;
export const SPRINT_RANGE = { min: 1, max: 60 };

/** A whole number of days in range, or the default for anything else. */
export function clampSprintDays(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_SPRINT_DAYS;
  return Math.min(SPRINT_RANGE.max, Math.max(SPRINT_RANGE.min, n));
}

export function getSprintDays(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    return raw == null ? DEFAULT_SPRINT_DAYS : clampSprintDays(raw);
  } catch {
    return DEFAULT_SPRINT_DAYS;
  }
}

export function setSprintDays(value, storage = globalThis.localStorage) {
  const days = clampSprintDays(value);
  try {
    storage?.setItem(KEY, String(days));
  } catch {
    /* storage unavailable: the default applies */
  }
  return days;
}

/** Longest a single bite can count, so a tab left open does not inflate minutes. */
export const MAX_BITE_MINUTES = 45;
const MIN_PER_ROW_CAP = 2;

/** Minutes spent in one bite from its real start and end, idle-capped. */
export function biteMinutes(doc) {
  const rows = (doc.rows || []).length;
  const start = Number(doc.startedAt || 0);
  const end = Number(doc.endedAt || 0);
  if (!start || !end || end <= start) return rows * 0.45; // no timing stored: old estimate
  const real = (end - start) / 60000;
  return Math.min(real, MAX_BITE_MINUTES, Math.max(1, rows * MIN_PER_ROW_CAP));
}
