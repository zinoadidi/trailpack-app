// Pure helpers for the Trail home (src/screens/trail.js). The drawing code
// stays in the screen; everything with a number in it is here and tested.
//
// `plan` is a normalised trail plan (see study/trail-normalise.js); `progress`
// is the factId -> mastery doc map.

import { GATE_PERCENT, campStates, countdown, dailyWalk, readiness, replay, trailComplete } from '../study/trail.js';
import { openCamp } from '../study/trail-normalise.js';
import { masterySummary } from '../study/mastery.js';

/** The path of camps as the screen draws it: dots with a state and a score. */
export function pathCamps(plan) {
  const states = campStates(plan);
  const openIndex = states.findIndex((camp) => camp.state === 'open');
  return states.map((camp) => ({
    ...camp,
    gate: GATE_PERCENT,
    passed: camp.state === 'summited',
    reachable: camp.state === 'summited' || camp.state === 'open',
    gateText: camp.score === null ? null : { score: camp.score, passed: camp.score >= GATE_PERCENT },
    current: camp.index === openIndex,
  }));
}

/** Which camps the screen can offer to study: the open one, else the last. */
export function studyCamp(plan) {
  const camp = openCamp(plan);
  if (!camp) return null;
  return {
    id: camp.id,
    title: camp.title,
    index: camp.index,
    facts: (camp.factIds || []).length,
    state: camp.state,
    readyForGate: camp.state === 'open',
  };
}

/**
 * Deadline mode: is a deadline set, how long is left, and is the plan behind?
 * `t` turns the re-plan sentence into the right language; without `t` the raw
 * key and values come back so the screen can translate them.
 */
export function deadlineState(plan, { now = Date.now(), t = null, sprintDays = 7 } = {}) {
  const deadline = plan ? plan.deadline : null;
  if (!deadline) return { has: false, countdown: null, behind: null, sprint: false, line: null };
  const left = countdown(deadline, now);
  const behind = replay({ startedAt: plan.startedAt, deadline, camps: plan.camps, now });
  const sprint = left.has && !left.overdue && left.days !== null && left.days <= sprintDays;
  let line = null;
  if (behind && behind.message) line = t ? t(behind.message.key, behind.message.values) : behind.message;
  return { has: true, countdown: left, behind: behind && behind.behindDays ? behind : null, sprint, line };
}

/** One readiness number, its parts, and the sentence to show beside it. */
export function readinessState(plan, progress, { lastStudyAt = null, mockScore = null, now = Date.now(), t = null } = {}) {
  const factIds = plan && Array.isArray(plan.camps) ? plan.camps.flatMap((camp) => camp.factIds || []) : [];
  const score = readiness({ progress, factIds, trail: plan, lastStudyAt, mockScore, now });
  return {
    ...score,
    line: t ? t('trail.readinessLine', { score: score.score }) : { key: 'trail.readinessLine', values: { score: score.score } },
  };
}

/**
 * The Daily Walk card: the goal, what is done today, and how many steps are
 * left. `done` is today's numbers from the store (0 on a fresh day).
 */
export function walkState(plan, progress, { now = Date.now(), done = {}, t = null } = {}) {
  const walk = dailyWalk({
    trail: plan,
    progress,
    now,
    minutesPerDay: (plan && plan.minutesPerDay) || 20,
    stepsDoneToday: done.steps || 0,
    minutesDoneToday: done.minutes || 0,
  });
  return {
    ...walk,
    percent: walk.minutesGoal ? Math.min(100, Math.round((walk.minutesDone / walk.minutesGoal) * 100)) : 0,
    doneLine: t ? t('trail.dailyWalkLine', { done: walk.minutesDone, goal: walk.minutesGoal }) : null,
    stepsLine: t ? t('trail.dailyWalkSteps', { done: walk.stepsDone, target: walk.stepsTarget }) : null,
    dueLine: t ? t('trail.dueNow', { count: walk.dueFacts }) : null,
  };
}

/** Mastery across the pack: "x of y facts mastered", for the header chip. */
export function masteryLine(plan, progress, { t = null } = {}) {
  const factIds = plan && Array.isArray(plan.camps) ? plan.camps.flatMap((camp) => camp.factIds || []) : [];
  const summary = masterySummary(progress || {}, factIds);
  return {
    ...summary,
    percent: summary.total ? Math.round((summary.mastered / summary.total) * 100) : 0,
    line: t ? t('trail.mastery', { mastered: summary.mastered, total: summary.total }) : null,
  };
}

/** The Trail home in one object, so a test can check it without the DOM. */
export function trailHome(plan, progress, { now = Date.now(), lastStudyAt = null, done = {}, t = null, sprintDays = 7 } = {}) {
  return {
    hasPlan: Boolean(plan && Array.isArray(plan.camps) && plan.camps.length),
    complete: trailComplete(plan),
    camps: pathCamps(plan),
    current: studyCamp(plan),
    walk: walkState(plan, progress, { now, done, t }),
    readiness: readinessState(plan, progress, { lastStudyAt, now, t }),
    deadline: deadlineState(plan, { now, t, sprintDays }),
    mastery: masteryLine(plan, progress, { t }),
  };
}
