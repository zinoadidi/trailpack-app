// Build a deterministic snapshot before persisting any replacement documents.
import { prepareAdditionPublish } from './additions.js';
import { freezePack } from './library.js';
import { newProgress } from './mastery.js';
import { progressId } from './progress-store.js';

const copy = (value) => structuredClone(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function sameFact(left, right) {
  if (!left || !right) return false;
  const { topicId: _leftTopic, ...leftContent } = left;
  const { topicId: _rightTopic, ...rightContent } = right;
  return JSON.stringify(canonical(leftContent)) === JSON.stringify(canonical(rightContent));
}

function validIds(items, mapping, existing, transform = (id) => id) {
  const ids = items.map((item) => mapping?.[item.id]);
  if (ids.some((id) => typeof id !== 'string' || !id)) return false;
  const keys = ids.map(transform);
  return new Set(keys).size === keys.length && keys.every((id) => !existing.has(id));
}

export function prepareReplacement({ draft, live, progress = {}, attempts = [], ids } = {}) {
  const addition = prepareAdditionPublish({ draft, live });
  if (!addition.ok) return addition;
  const createdAt = ids?.createdAt;
  const now = Date.parse(createdAt);
  if (!ids?.packId || ids.packId === live.pack.id || !Number.isFinite(now)) return { ok: false, reason: 'invalid_ids' };

  const topics = [...live.topics, ...addition.topics];
  const proposedById = new Map(draft.facts.map((fact) => [fact.id, fact]));
  const facts = [...live.facts.filter((fact) => proposedById.has(fact.id)).map((fact) => proposedById.get(fact.id)), ...addition.facts];
  const originalFacts = new Set(live.facts.map((fact) => fact.id));
  const unchangedFacts = new Set(live.facts.filter((fact) => sameFact(fact, proposedById.get(fact.id))).map((fact) => fact.id));
  const baselineAttempts = attempts.map((attempt) => ({ ...copy(attempt), rows: (attempt.rows || []).filter((row) => originalFacts.has(row?.factId)) }))
    .filter((attempt) => attempt.rows.length);
  const related = baselineAttempts.map((attempt) => ({ ...copy(attempt), rows: attempt.rows.filter((row) => unchangedFacts.has(row.factId)) }))
    .filter((attempt) => attempt.rows.length);
  const existingTopicIds = new Set([...live.topics, ...draft.topics].map((item) => item.id));
  const existingFactIds = new Set([...live.facts, ...draft.facts].map((item) => item.id));
  const existingProgressIds = new Set([...existingFactIds].map(progressId));
  const existingAttemptIds = new Set(attempts.map((item) => item.biteId));
  if (!validIds(topics, ids.topicIds, existingTopicIds) ||
      !validIds(facts, ids.factIds, existingFactIds) ||
      !validIds(facts, ids.factIds, existingProgressIds, progressId) ||
      !validIds(related.map((item) => ({ id: item.biteId })), ids.attemptIds, existingAttemptIds)) {
    return { ok: false, reason: 'invalid_ids' };
  }
  const frozen = freezePack({ ...copy(addition.pack), id: ids.packId },
    topics.map((topic) => ({ ...copy(topic), id: ids.topicIds[topic.id] })),
    facts.map((fact) => ({ ...copy(fact), id: ids.factIds[fact.id], topicId: ids.topicIds[fact.topicId] })),
    { now: createdAt });
  const copiedProgress = facts.map((fact) => ({
    ...(unchangedFacts.has(fact.id) && progress[fact.id] ? copy(progress[fact.id]) : newProgress(ids.factIds[fact.id], { packId: ids.packId, now })),
    factId: ids.factIds[fact.id], packId: ids.packId,
  }));
  const copiedAttempts = related.map((attempt) => ({
    ...copy(attempt), biteId: ids.attemptIds[attempt.biteId],
    rows: attempt.rows.map((row) => ({ ...copy(row), factId: ids.factIds[row.factId] })),
  }));
  return {
    ok: true, ...frozen, progress: copiedProgress, attempts: copiedAttempts,
    originalBaseline: { ...copy(live), progress: copy(progress), attempts: baselineAttempts },
  };
}
