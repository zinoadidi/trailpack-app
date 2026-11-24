// The numbers the Progress screen shows: the active Pack, its facts and
// mastery per topic, plus the Trail readiness. Pure helpers here; the thin
// loader reads the device store and is safe to call with no store at all.

import { state } from '../app/state.js';
import { masterySummary } from '../study/mastery.js';
import { readiness } from '../study/trail.js';
import { resolveActivePack } from '../study/store.js';
import { loadPlan, loadProgress, loadAttempts, withBlank } from '../study/progress-store.js';

/**
 * Facts, topics and mastery counts for a pack, with a blank progress doc for
 * every fact so a new account still gets one row per topic.
 */
export function packMastery(pack, topics = [], facts = [], progress = {}) {
  const all = withBlank(progress || {}, facts);
  const factIds = facts.map((fact) => fact.id);
  const summary = masterySummary(all, factIds);
  return { pack, topics, facts, progress: all, factIds, summary };
}

/** Mastery per topic, in topic order, plus an "Other" row for stray facts. */
export function masterProgress(snapshot) {
  const topics = (snapshot && snapshot.topics) || [];
  const facts = (snapshot && snapshot.facts) || [];
  const progress = (snapshot && snapshot.progress) || {};
  const counts = new Map();
  for (const fact of facts) {
    const key = (topics.find((topic) => topic.id === fact.topicId) || {}).id || 'other';
    const row = counts.get(key) || { id: key, total: 0, mastered: 0, learning: 0 };
    row.total += 1;
    const stateName = progress[fact.id] ? progress[fact.id].state : 'new';
    if (stateName === 'mastered') row.mastered += 1;
    else if (stateName !== 'new') row.learning += 1;
    counts.set(key, row);
  }
  const rows = topics.map((topic) => counts.get(topic.id)).filter(Boolean);
  const other = counts.get('other');
  if (other) rows.push({ ...other, id: 'other' });
  return rows.map((row) => ({
    ...row,
    title: row.id === 'other' ? 'Other' : (topics.find((topic) => topic.id === row.id) || {}).title || row.id,
    percent: row.total ? Math.round((row.mastered / row.total) * 100) : 0,
  }));
}

/** The readiness score of a snapshot, from the same logic the Trail uses. */
export function snapshotReadiness(snapshot, { lastStudyAt = null, mockScore = null, now = Date.now() } = {}) {
  const safe = snapshot || { progress: {}, factIds: [], plan: null };
  return readiness({ progress: safe.progress || {}, factIds: safe.factIds || [], trail: safe.plan || null, lastStudyAt, mockScore, now });
}

/**
 * Everything the Progress screen needs from the device, in one read.
 * Without a pack or store it answers an empty snapshot, never throws.
 */
export async function readStudySnapshot(store = state.store, { now = Date.now() } = {}) {
  const empty = { pack: null, topics: [], facts: [], progress: {}, factIds: [], summary: masterySummary({}, []), plan: null, readiness: readiness({}), factCount: 0 };
  let bundle = null;
  try {
    bundle = await resolveActivePack(store);
  } catch {
    bundle = null;
  }
  if (!bundle || !bundle.pack) return empty;
  const packId = bundle.pack.id;
  const [progress, plan, attempts] = await Promise.all([
    loadProgress(packId, store).catch(() => ({})),
    loadPlan(packId, store).catch(() => null),
    loadAttempts({ limit: 1, store }).catch(() => []),
  ]);
  const snapshot = packMastery(bundle.pack, bundle.topics || [], bundle.facts || [], progress);
  const lastStudyAt = attempts[0] ? new Date(Number(attempts[0].endedAt || attempts[0].startedAt) || 0).toISOString() : null;
  return {
    ...snapshot,
    plan,
    factCount: snapshot.factIds.length,
    readiness: snapshotReadiness({ ...snapshot, plan }, { lastStudyAt, now }),
  };
}
