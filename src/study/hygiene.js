// Data hygiene: a fact that is deleted must take its mastery progress and any
// attempt rows that named it with it, so no orphan rows stay behind (design:
// the pack is the only owner of a fact). `deletedFactIds` is pure; the rest is
// thin store plumbing next to it.

import { FACT } from './store.js';
import { PROGRESS, ATTEMPT, progressId } from './progress-store.js';

/** One progress row per fact, keyed `p_<factId>`, so the id is derivable. */
export function progressDocId(factId) {
  return progressId(factId);
}

/**
 * Which progress rows and attempt ids a fact delete touches.
 * Attempts are whole bites, so an attempt row is kept when it still names
 * another live fact: `rows` only holds its remaining facts.
 */
export function deletionPlan({ factId, allFacts = [], attempts = [] } = {}) {
  const progressIds = factId ? [progressDocId(factId)] : [];
  const live = new Set((allFacts || []).map((fact) => fact.id).filter((id) => id && id !== factId));
  const attemptsUpdate = [];
  const attemptsDelete = [];
  for (const doc of attempts || []) {
    const rows = Array.isArray(doc && doc.rows) ? doc.rows : [];
    if (!rows.some((row) => row && row.factId === factId)) continue;
    const kept = rows.filter((row) => row && row.factId !== factId);
    if (kept.some((row) => live.has(row.factId))) attemptsUpdate.push({ id: doc.biteId, rows: kept });
    else attemptsDelete.push(doc.biteId);
  }
  return { progressIds, attemptsUpdate, attemptsDelete };
}

/** Facts that a set of topic drops removes: only the facts no kept topic owns. */
export function factsRemovedWithTopics(facts = [], topicIds = [], keptTopicIds = null) {
  const dropped = new Set(topicIds || []);
  const kept = keptTopicIds ? new Set(keptTopicIds) : null;
  return (facts || []).filter((fact) => dropped.has(fact.topicId) && !(kept && kept.has(fact.topicId))).map((fact) => fact.id);
}
