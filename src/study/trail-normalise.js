// Trail plans stored as sync docs read back from a server, another device or
// an older build. This fills gaps so the Trail screen and the gate maths never
// throw on a partial doc, and migrates camps planned before the `id` rule.
//
// Pure, plain objects only.

export const PLAN_VERSION = 1;

const STATES = ['locked', 'open', 'summited'];

export function normalisePlan(doc, packId = null) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.camps)) {
    return {
      v: PLAN_VERSION,
      id: 'trail_' + String(packId || 'pack').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 56),
      packId: packId || null,
      camps: [],
      openIndex: -1,
      startedAt: null,
      deadline: null,
      minutesPerDay: 20,
      updatedAt: null,
    };
  }
  const camps = doc.camps
    .filter((camp) => camp && typeof camp === 'object')
    .map((camp, index) => ({
      id: camp.id || `camp_${index + 1}`,
      index,
      title: String(camp.title || `Camp ${index + 1}`).slice(0, 160),
      titleSource: Array.isArray(camp.titleSource) ? camp.titleSource.map(String).slice(0, 8) : [],
      topicIds: Array.isArray(camp.topicIds) ? camp.topicIds.map(String) : [],
      factIds: Array.isArray(camp.factIds) ? camp.factIds.map(String) : [],
      state: STATES.includes(camp.state) ? camp.state : index === 0 ? 'open' : 'locked',
      checkpoint: camp.checkpoint && typeof camp.checkpoint === 'object'
        ? {
            score: clampInt(camp.checkpoint.score, 0, 100, 0),
            passedAt: camp.checkpoint.passedAt ?? null,
            attempts: clampInt(camp.checkpoint.attempts, 0, 1000, 0),
          }
        : null,
      packId: camp.packId || doc.packId || packId || null,
    }));
  // Only one camp is open at a time: the first one that says so wins.
  let seenOpen = false;
  for (const camp of camps) {
    if (camp.state === 'open' && seenOpen) camp.state = 'locked';
    if (camp.state === 'open') seenOpen = true;
  }
  const openIndex = camps.findIndex((camp) => camp.state === 'open');
  return {
    ...doc,
    v: PLAN_VERSION,
    packId: doc.packId || packId || null,
    camps,
    openIndex: openIndex < 0 ? camps.length : openIndex,
    startedAt: doc.startedAt || null,
    deadline: doc.deadline || null,
    minutesPerDay: clampInt(doc.minutesPerDay, 5, 240, 20),
  };
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** The camp the learner is on, or the last one when every camp is summited. */
export function openCamp(plan) {
  if (!plan || !Array.isArray(plan.camps) || !plan.camps.length) return null;
  return plan.camps.find((camp) => camp.state === 'open') || plan.camps[plan.camps.length - 1];
}

/** Camp ids that already carry a checkpoint. */
export function summitedCamps(plan) {
  return ((plan && plan.camps) || []).filter((camp) => camp.state === 'summited');
}
