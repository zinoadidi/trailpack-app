// The Trail (design 3.4): camps ordered by prerequisites and importance, the
// Daily Walk, 70% gates, the readiness score and deadline mode.
//
// Pure functions over plain objects. The planner is deterministic: the same
// pack, dates and progress always give the same trail, so a re-plan is a small
// diff the screen can explain ("Moved Camp 4 to Thursday").
//
// Shape (sync doc `plans`, id `trail_<packId>`):
//   {v, packId, camps: [{id, index, title, topicIds, factIds, state,
//                        checkpoint: {score, passedAt} | null}],
//    openIndex, startedAt, deadline, minutesPerDay, updatedAt}
// Camp states: 'locked' | 'open' | 'summited'.

import { dayOf, masterySummary } from './mastery.js';

export const TRAIL_VERSION = 1;
export const GATE_PERCENT = 70;
export const DEFAULT_MINUTES = 20;
export const MINUTES_PER_STEP = 0.9;

/**
 * Split a pack into camps. Small packs become one camp, a medium pack gets one
 * camp per topic group of a sensible size, and the last camp always ends in the
 * Summit Mock.
 */
export function planCamps(topics = [], facts = [], { maxFactsPerCamp = 12, packId = null } = {}) {
  const ordered = [...topics].sort((a, b) => (a.order || 0) - (b.order || 0));
  const byTopic = new Map(ordered.map((topic) => [topic.id, []]));
  for (const fact of facts) {
    if (!byTopic.has(fact.topicId)) byTopic.set(fact.topicId, []);
    byTopic.get(fact.topicId).push(fact);
  }
  // Greedy bin packing in topic order: one topic is never split when it fits.
  const groups = [];
  let current = { topics: [], facts: [] };
  for (const topic of ordered) {
    const list = byTopic.get(topic.id) || [];
    if (!list.length) continue;
    if (current.facts.length && current.facts.length + list.length > maxFactsPerCamp) {
      groups.push(current);
      current = { topics: [], facts: [] };
    }
    current.topics.push(topic);
    current.facts.push(...list);
  }
  if (current.facts.length) groups.push(current);
  if (!groups.length) return [];
  return groups.map((group, index) => ({
    id: `camp_${index + 1}`,
    index,
    title: group.topics.length === 1 ? group.topics[0].title : `${index + 1}`,
    titleSource: group.topics.map((topic) => topic.title),
    topicIds: group.topics.map((topic) => topic.id),
    factIds: group.facts.map((fact) => fact.id),
    state: index === 0 ? 'open' : 'locked',
    checkpoint: null,
    packId,
  }));
}

/** Facts in a camp that are allowed in a checkpoint (uncertain ones wait). */
export function gateFacts(camp, facts = []) {
  const ids = new Set(camp.factIds || []);
  return facts.filter((fact) => ids.has(fact.id) && !fact.check);
}

/** Checkpoint score for a camp: share of its gate facts answered right. */
export function checkpointScore(camp, answers = []) {
  const total = (camp.factIds || []).length;
  if (!total) return { score: 100, correct: 0, total: 0 };
  const right = answers.filter((answer) => answer && answer.correct === true).length;
  return { score: Math.round((right / total) * 100), correct: right, total };
}

/**
 * A checkpoint result: pass at the gate (70% by default), summits the camp and
 * opens the next one. Failing lists the facts to revisit.
 */
export function applyCheckpoint(trail, campId, answers, { when = Date.now(), gate = GATE_PERCENT } = {}) {
  const camps = trail.camps.map((camp) => ({ ...camp }));
  const index = camps.findIndex((camp) => camp.id === campId);
  if (index < 0) return { trail, passed: false, reason: 'unknown_camp' };
  const camp = camps[index];
  const { score, correct, total } = checkpointScore(camp, answers);
  const passed = score >= gate;
  const missed = new Set((answers || []).filter((a) => !a || a.correct !== true).map((a) => a && a.factId).filter(Boolean));
  camp.checkpoint = { score, passedAt: passed ? when : null, attempts: ((camp.checkpoint && camp.checkpoint.attempts) || 0) + 1 };
  if (passed) {
    camp.state = 'summited';
    const next = camps[index + 1];
    if (next && next.state === 'locked') next.state = 'open';
  }
  const openIndex = camps.findIndex((item) => item.state === 'open');
  return {
    trail: { ...trail, camps, openIndex: openIndex < 0 ? camps.length : openIndex, updatedAt: when },
    passed,
    score,
    correct,
    total,
    missed: [...missed],
    toRevisit: [...missed],
  };
}

/** Is every camp summited (the certificate condition, with the mock)? */
export function trailComplete(trail) {
  const camps = (trail && trail.camps) || [];
  return camps.length > 0 && camps.every((camp) => camp.state === 'summited');
}

/**
 * Readiness (design 3.4): a weighted mix of fact recall, checkpoint scores and
 * recency. Recall comes from mastery progress, checkpoints from the gate
 * results, recency from how many days since the last study day.
 */
export function readiness({ progress = {}, factIds = [], trail = null, lastStudyAt = null, mockScore = null, now = Date.now() } = {}) {
  const summary = masterySummary(progress, factIds);
  const recall = summary.total ? (summary.mastered + summary.counts.review * 0.6 + summary.counts.learning * 0.3) / summary.total : 0;
  const camps = (trail && trail.camps) || [];
  const summited = camps.filter((camp) => camp.state === 'summited');
  const scores = summited.map((camp) => (camp.checkpoint ? camp.checkpoint.score : GATE_PERCENT));
  const checkpoint = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length / 100 : 0;
  const campShare = camps.length ? summited.length / camps.length : 0;
  const daysSince = lastStudyAt ? Math.max(0, Math.floor((now - Date.parse(lastStudyAt)) / 86400000)) : 30;
  const recency = Math.max(0.5, 1 - daysSince / 14);
  const mock = mockScore === null ? null : Math.max(0, Math.min(1, mockScore));
  // A pack with no trail yet is judged on recall alone; once a trail exists
  // the camp and checkpoint parts count too and their weights are renormalised.
  const parts = !camps.length
    ? [['recall', recall, 1]]
    : mock === null
      ? [['recall', recall, 0.5], ['checkpoints', checkpoint, 0.3], ['camps', campShare, 0.2]]
      : [['recall', recall, 0.4], ['checkpoints', checkpoint, 0.25], ['camps', campShare, 0.15], ['mock', mock, 0.2]];
  const score = parts.reduce((sum, [, value, weight]) => sum + value * weight, 0) * recency;
  return { score: Math.round(Math.max(0, Math.min(1, score)) * 100), parts: Object.fromEntries(parts.map(([name, value]) => [name, Math.round(value * 100)])), recency: Math.round(recency * 100) };
}

/**
 * The Daily Walk (design 3.4): a minutes goal and 3 to 6 steps, from the due
 * queue, the open camp and the deadline. `done` are today's finished steps.
 */
export function dailyWalk({ trail = null, progress = {}, now = Date.now(), minutesPerDay = DEFAULT_MINUTES, stepsDoneToday = 0, minutesDoneToday = 0 } = {}) {
  const camps = (trail && trail.camps) || [];
  const camp = camps.find((item) => item.state === 'open') || camps[camps.length - 1] || null;
  const ids = new Set();
  for (const doc of Object.values(progress || {})) {
    if (doc && doc.state !== 'mastered' && Number(doc.dueAt) <= now) ids.add(doc.factId);
  }
  const campDue = camp ? camp.factIds.filter((id) => ids.has(id)).length : 0;
  const target = Math.max(3, Math.min(6, Math.round(minutesPerDay / MINUTES_PER_STEP / 6) + 3));
  const minutesGoal = Math.max(5, Math.round(minutesPerDay));
  return {
    campId: camp ? camp.id : null,
    campTitle: camp ? camp.title : null,
    dueFacts: ids.size,
    campDue,
    stepsTarget: target,
    stepsDone: Math.max(0, stepsDoneToday),
    minutesGoal,
    minutesDone: Math.max(0, minutesDoneToday),
    met: minutesDoneToday >= minutesGoal,
    day: dayOf(now),
    remaining: Math.max(0, target - stepsDoneToday),
  };
}

/**
 * Days and hours to the deadline, plus the plain sentence the trail shows
 * ("You are 1 day behind. Moved Camp 4 to Thursday. Readiness estimate 78%.").
 */
export function countdown(deadline, now = Date.now()) {
  if (!deadline) return { has: false, days: null, hours: null, text: null };
  const target = typeof deadline === 'string' ? Date.parse(deadline) : deadline;
  const ms = Math.max(0, target - now);
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return { has: true, days, hours, overdue: target < now, text: days >= 1 ? `${days}d ${hours}h` : `${hours}h` };
}

/**
 * Re-plan after missed days. `campsPerDay` is how many camps the plan expects
 * each day; a plan that is behind says so plainly instead of hiding it.
 */
export function replay({ startedAt, deadline, camps, now = Date.now() } = {}) {
  const start = typeof startedAt === 'string' ? Date.parse(startedAt) : startedAt || now;
  const target = deadline ? (typeof deadline === 'string' ? Date.parse(deadline) : deadline) : null;
  if (!target || !Array.isArray(camps) || !camps.length) return { behindDays: 0, message: null };
  const totalDays = Math.max(1, Math.ceil((target - start) / 86400000));
  const elapsed = Math.max(0, Math.floor((now - start) / 86400000));
  const left = camps.filter((camp) => camp.state !== 'summited').length;
  if (!left) return { behindDays: 0, message: null };
  // How many camps the original pace expected by now, against how many are
  // summited: the gap, expressed in whole days of the original pace.
  const expectedDone = Math.min(camps.length, Math.floor((elapsed / totalDays) * camps.length));
  const done = camps.length - left;
  const campsBehind = Math.max(0, expectedDone - done);
  const behindDays = Math.ceil(campsBehind / Math.max(0.5, camps.length / totalDays));
  const daysLeft = Math.max(0, Math.ceil((target - now) / 86400000));
  const campsLeft = left;
  const nextDate = new Date(now + Math.ceil((daysLeft / Math.max(1, campsLeft)) * 86400000));
  return {
    behindDays,
    daysLeft,
    campsLeft,
    campsBehind,
    perDay: camps.length / totalDays,
    nextCampDate: nextDate.toISOString(),
    message: behindDays
      ? { key: 'trail.behind', values: { days: behindDays, camp: campsLeft, date: nextDate.toLocaleDateString(undefined, { weekday: 'long' }) } }
      : null,
  };
}

/**
 * The label for each camp in the trail map: done, current, next, locked.
 */
export function campStates(trail) {
  const camps = (trail && trail.camps) || [];
  const openIndex = camps.findIndex((camp) => camp.state === 'open');
  return camps.map((camp, index) => ({
    id: camp.id,
    index,
    title: camp.title,
    state: camp.state,
    label: camp.state === 'summited' ? 'summited' : camp.state === 'open' ? 'current' : index === openIndex + 1 ? 'next' : 'locked',
    facts: (camp.factIds || []).length,
    score: camp.checkpoint ? camp.checkpoint.score : null,
  }));
}

/** Does a pack already have a trail? */
export function planId(packId) {
  return 'trail_' + String(packId || 'pack').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 56);
}
