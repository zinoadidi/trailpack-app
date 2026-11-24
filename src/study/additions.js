// An addition draft never changes the documents used by the live Trail.
import { freezePack } from './library.js';
import { mergeIntoPack } from './pack.js';

const copy = (value) => structuredClone(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

export function beginAdditionDraft({ pack, topics, facts }) {
  return {
    pack: { ...copy(pack), status: 'draft' },
    topics: copy(topics),
    facts: copy(facts),
    edits: { dropped: [], renamed: {}, merged: {} },
    additionBase: {
      packId: pack.id,
      sources: copy(pack.sources || []),
      topics: copy(topics),
      facts: copy(facts),
      startedAt: new Date().toISOString(),
    },
  };
}

function originalUnchanged(original, current) {
  const byId = new Map(current.map((item) => [item.id, item]));
  return original.every((item) => same(item, byId.get(item.id)));
}

function additions(original, proposed, current) {
  const oldIds = new Set(original.map((item) => item.id));
  const currentById = new Map(current.map((item) => [item.id, item]));
  const seen = new Set();
  const result = [];
  for (const item of proposed) {
    if (!item?.id || seen.has(item.id)) return null;
    seen.add(item.id);
    if (oldIds.has(item.id)) continue;
    const existing = currentById.get(item.id);
    if (existing && !same(existing, item)) return null;
    if (!existing) result.push(item);
  }
  return result;
}

function previouslyWritten(original, proposed, current) {
  const oldIds = new Set(original.map((item) => item.id));
  const currentById = new Map(current.map((item) => [item.id, item]));
  return proposed.filter((item) => !oldIds.has(item.id) && same(item, currentById.get(item.id)));
}

export function prepareAdditionPublish({ draft, live }) {
  const base = draft?.additionBase;
  if (!base || !live?.pack || live.pack.id !== base.packId || draft.pack?.id !== base.packId || live.pack.status !== 'frozen') {
    return { ok: false, reason: 'invalid_draft' };
  }
  const sources = live.pack.sources || [];
  if (!originalUnchanged(base.sources, sources) || !originalUnchanged(base.topics, live.topics) || !originalUnchanged(base.facts, live.facts)) {
    return { ok: false, reason: 'conflict' };
  }
  const proposed = freezePack(draft.pack, draft.topics, draft.facts, { now: base.startedAt });
  const newSources = additions(base.sources, draft.pack.sources || [], sources);
  const newTopics = additions(base.topics, proposed.topics, live.topics);
  const newFacts = additions(base.facts, proposed.facts, live.facts);
  if (!newSources || !newTopics || !newFacts) return { ok: false, reason: 'conflict' };
  const topicIds = new Set([...live.topics, ...newTopics].map((topic) => topic.id));
  if (newFacts.some((fact) => !topicIds.has(fact.topicId))) return { ok: false, reason: 'invalid_topic' };
  const { added } = mergeIntoPack(live.facts, newFacts);
  return {
    ok: true,
    pack: { ...copy(live.pack), sources: [...copy(sources), ...copy(newSources)] },
    topics: copy(newTopics),
    facts: copy(added),
    retryTopics: copy(previouslyWritten(base.topics, proposed.topics, live.topics)),
    retryFacts: copy(previouslyWritten(base.facts, proposed.facts, live.facts)),
  };
}
