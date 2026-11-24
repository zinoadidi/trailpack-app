// Levels: thresholds scaled to the Pack length (design 4.3), and level names per
// Pack kind. Pure, no DOM.

/** A level ladder: ascending `min` points and a name key suffix per level. */
export const KIND_LADDERS = {
  interview: ['analyst', 'senior', 'staff', 'lead', 'principal'],
  exam: ['novice', 'student', 'practiced', 'expert', 'master'],
  cert: ['starter', 'certified', 'advanced', 'specialist', 'authority'],
  other: ['starter', 'walker', 'climber', 'ranger', 'summit'],
};

export const DEFAULT_THRESHOLDS = [300, 800, 1500, 2500];

export const LADDER_KINDS = Object.keys(KIND_LADDERS);

/**
 * Points thresholds for a Pack. `factCount` scales the base values (which were
 * tuned for a medium pack) so a tiny pack still levels and a huge one does not
 * level on day one. The factor is clamped to 0.5x to 2x.
 */
export function levelThresholds(factCount) {
  const facts = Number.isFinite(factCount) && factCount > 0 ? factCount : 0;
  if (!facts) return [...DEFAULT_THRESHOLDS];
  const factor = Math.min(2, Math.max(0.5, facts / 60));
  return DEFAULT_THRESHOLDS.map((value) => Math.max(50, Math.round((value * factor) / 50) * 50));
}

export function normaliseKind(kind) {
  return kind in KIND_LADDERS ? kind : 'other';
}

/** Name key suffix for a level (1 based) in a Pack kind. */
export function levelName(kind, level) {
  const names = KIND_LADDERS[normaliseKind(kind)];
  const index = Math.min(names.length, Math.max(1, level)) - 1;
  return names[index];
}

/**
 * Level state for a points total.
 * @returns {{ level: number, name: string, kind: string, points: number,
 *   levelStart: number, levelEnd: number|null, toNext: number|null, progress: number }}
 */
export function levelFor(points, { kind = 'other', factCount = 0 } = {}) {
  const total = Math.max(0, Number(points) || 0);
  const thresholds = levelThresholds(factCount);
  let level = 1;
  for (const threshold of thresholds) {
    if (total >= threshold) level += 1;
  }
  const start = level === 1 ? 0 : thresholds[level - 2];
  const end = level <= thresholds.length ? thresholds[level - 1] : null;
  const span = end === null ? 0 : end - start;
  return {
    level,
    name: levelName(kind, level),
    kind: normaliseKind(kind),
    points: total,
    levelStart: start,
    levelEnd: end,
    toNext: end === null ? null : Math.max(0, end - total),
    progress: end === null ? 1 : Math.min(1, Math.max(0, (total - start) / span)),
  };
}

/** True when a points change crosses a threshold. */
export function levelUp(before, after, options = {}) {
  return levelFor(after, options).level > levelFor(before, options).level;
}
