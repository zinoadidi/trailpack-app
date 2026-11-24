// What a camp card shows on the Trail home: its gate result, whether the
// camp can be opened, and the "study this camp" target. Pure, so the screen
// and the gate maths agree on what a learner sees after a checkpoint.

import { GATE_PERCENT, checkpointScore, gateFacts } from '../study/trail.js';

/**
 * One camp's card: the gate score with pass or fail, how many facts the gate
 * asks, and whether the camp is open for study.
 */
export function campCard(camp, facts = []) {
  if (!camp) return null;
  const gate = gateFacts(camp, facts);
  const last = camp.checkpoint || null;
  const passed = camp.state === 'summited';
  return {
    id: camp.id,
    index: camp.index,
    title: camp.title,
    state: camp.state,
    facts: (camp.factIds || []).length,
    gateFacts: gate.length,
    gate: GATE_PERCENT,
    score: last ? Math.round(Number(last.score) || 0) : null,
    passed,
    failedAt: !passed && last ? Math.round(Number(last.score) || 0) : null,
    canStudy: camp.state === 'open',
    canGate: camp.state === 'open' && gate.length > 0,
    target: camp.state === 'open' ? '#/study?camp=' + encodeURIComponent(camp.id) : null,
  };
}

/** Every camp card from the whole gate answer list of the last attempt. */
export function campCards(camps, facts = []) {
  return (camps || []).map((camp) => campCard(camp, facts));
}

/** The score a checkpoint would give, for the card's preview line. */
export function previewGate(camp, answers = []) {
  const score = checkpointScore(camp, answers);
  return { ...score, passed: score.score >= GATE_PERCENT, gate: GATE_PERCENT };
}
