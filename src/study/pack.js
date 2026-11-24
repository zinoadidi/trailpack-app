// Pack model: how extracted sources become a Pack (topics, facts, variants).
// Pure functions only, so ingest, review and later merges can be tested
// without a DOM, IndexedDB or network. The sync layer stores the result as
// docs in `packs`, `topics` and `facts`.
//
// Shapes (sync docs):
//   packs   {id, title, goal, kind, status: 'draft'|'frozen', lensDefault,
//            sources: [{id, name, type, size, fileId?, at, words, chunks}],
//            review: {generatedAt, model} | null, createdAt, updatedAt}
//   topics  {id, packId, title, summary, order, confidence?}
//   facts   {id, packId, topicId, statement, chunkId, sourceId, page,
//            importance, confidence, check?, variants: [...], createdAt}

export const MIN_VARIANTS = 3;
export const PRODUCTION_TYPES = ['cloze', 'order', 'voice', 'teach-back', 'scenario', 'task'];

/**
 * Ids must match ^[A-Za-z0-9_-]{1,64}$ (API.md). Accents are folded to their
 * base letter (Über -> uber), everything else becomes a dash, and the result
 * never starts or ends with a dash.
 */
export function safeId(value, fallback = 'item') {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64)
    .replace(/^[-_]+|[-_]+$/g, '');
  return cleaned || fallback;
}

export function newId(prefix = 'id', random = Math.random) {
  const body = Math.floor(random() * 36 ** 10)
    .toString(36)
    .padStart(10, '0');
  return `${safeId(prefix, 'id')}_${body}`.slice(0, 64);
}

// ------------------------------------------------------------- ingest mapping

/**
 * The map task returns topics that contain facts. Normalise to a stable shape,
 * dropping anything that could not be stored or studied:
 * - ids are made safe and unique,
 * - statements are trimmed and de-duplicated,
 * - importance and confidence are clamped to their ranges,
 * - every fact keeps the chunk it came from (the chunk anchor is the source).
 */
/** Short stable hash, so fact ids from different batches never collide. */
export function shortHash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const META_RE = /^(the|this) (text|document|passage|excerpt|chapter|source|author|section|page|lecture|slides?)\b.{0,40}\b(includes?|contains?|discusses|describes|mentions|states|covers|is about|provides|presents|outlines|lists)\b/i;
const LOGISTICS_RE = /\b(isbn|copyright|all rights reserved|office hours|syllabus|grading|grade breakdown|late policy|attendance|textbook edition|published by|edition,? \d{4}|credit hours?|prerequisites?:)\b/i;

/** Why a statement is not study material, or '' when it is fine. */
export function junkReason(statement) {
  if (/_{3,}|\[\s*\]|\.{4,}/.test(statement)) return 'blank';
  if (META_RE.test(statement)) return 'meta';
  if (LOGISTICS_RE.test(statement)) return 'logistics';
  return '';
}

export function normaliseMap(raw, { packId, chunks = [], random = Math.random } = {}) {
  const chunkIds = new Set(chunks.map((c) => c.id));
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const seenStatements = new Set();
  const usedTopicIds = new Set();
  const topics = [];
  const facts = [];
  const warnings = [];

  const list = Array.isArray(raw && raw.topics) ? raw.topics : [];
  list.forEach((topic, topicIndex) => {
    const title = String(topic.title || '').trim();
    if (!title) return;
    let topicId = safeId(topic.id, `t${topicIndex + 1}`);
    if (usedTopicIds.has(topicId)) topicId = `${topicId.slice(0, 56)}_${topicIndex + 1}`;
    usedTopicIds.add(topicId);
    topics.push({
      id: topicId,
      packId,
      title: title.slice(0, 160),
      summary: String(topic.summary || '').trim().slice(0, 600),
      order: topics.length,
      merged: 0,
    });
    const factList = Array.isArray(topic.facts) ? topic.facts : [];
    for (const fact of factList) {
      const statement = String(fact.statement || '').trim().replace(/\s+/g, ' ');
      // A fact has to carry a claim: enough characters and enough words.
      if (statement.length < 12 || statement.split(' ').filter(Boolean).length < 3) continue;
      // Blank templates, talk about the document itself and course logistics
      // are not study material.
      const junk = junkReason(statement);
      if (junk) {
        warnings.push({ code: junk, statement });
        continue;
      }
      // Same rule as mergeIntoPack, so punctuation and case do not slip through.
      const key = normaliseStatement(statement);
      if (seenStatements.has(key)) {
        warnings.push({ code: 'duplicate', statement });
        continue;
      }
      seenStatements.add(key);
      let chunkId = chunkIds.has(fact.chunk_id) ? fact.chunk_id : fact.chunkId && chunkIds.has(fact.chunkId) ? fact.chunkId : null;
      if (!chunkId) {
        warnings.push({ code: 'uncited', statement });
        chunkId = null;
      }
      const chunk = chunkId ? chunkById.get(chunkId) : null;
      const confidence = Number(fact.confidence);
      facts.push({
        id: safeId(`f_${topicId}_${safeId(fact.id || '')}_${shortHash(normaliseStatement(statement))}`, newId('f', random)),
        packId,
        topicId,
        statement: statement.slice(0, 600),
        chunkId,
        sourceId: chunk ? chunk.source : null,
        page: chunk ? chunk.page : null,
        importance: clampInt(fact.importance, 1, 5, 3),
        confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.8,
        check: Number.isFinite(confidence) && confidence < 0.5 ? 1 : 0,
        variants: [],
        createdAt: null,
      });
    }
  });
  return { topics, facts, warnings };
}

export function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Merge newly mapped facts into an existing pack without touching progress:
 * statements that are already known (same normalised text) are skipped, new
 * ones are added as New. Returns counts for the "adding documents later" view.
 */
export function mergeIntoPack(existingFacts, incomingFacts) {
  const known = new Set(existingFacts.map((f) => normaliseStatement(f.statement)));
  const added = [];
  const skipped = [];
  for (const fact of incomingFacts) {
    const key = normaliseStatement(fact.statement);
    if (known.has(key)) {
      skipped.push(fact);
      continue;
    }
    known.add(key);
    added.push(fact);
  }
  return { added, skipped };
}

export function normaliseStatement(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Review screen state is a plain topic list; this applies the user's edits
 * (rename, merge, drop) and renumbers. Facts follow their topic id.
 */
export function applyReviewEdits(topics, edits, facts) {
  const drop = new Set(edits.dropped || []);
  const rename = edits.renamed || {};
  const merge = edits.merged || {};
  const kept = topics.filter((topic) => !drop.has(topic.id)).map((topic) => ({ ...topic, title: rename[topic.id] ? String(rename[topic.id]).slice(0, 160) : topic.title }));
  const byId = new Map(kept.map((topic) => [topic.id, topic]));
  for (const topic of kept) {
    const target = merge[topic.id];
    if (!target || target === topic.id || !byId.has(target)) continue;
    const into = byId.get(target);
    into.summary = into.summary || topic.summary;
    byId.delete(topic.id);
  }
  const finalTopics = [...byId.values()].map((topic, order) => ({ ...topic, order }));
  const alive = new Set(finalTopics.map((topic) => topic.id));
  const finalFacts = [];
  const seen = new Set();
  for (const fact of facts) {
    const topicId = merge[fact.topicId] && alive.has(merge[fact.topicId]) ? merge[fact.topicId] : fact.topicId;
    if (!alive.has(topicId)) continue;
    const key = normaliseStatement(fact.statement);
    if (seen.has(key)) continue;
    seen.add(key);
    finalFacts.push({ ...fact, topicId });
  }
  return { topics: finalTopics, facts: finalFacts };
}

// ------------------------------------------------------------------- variants

/** Types that count as a production format for mastery. */
export function isProduction(type) {
  return PRODUCTION_TYPES.includes(type);
}

/**
 * Keep only well formed variants, tag each with its type, and report whether
 * the fact still needs more. Anything the model wrote that we cannot render
 * is dropped rather than shown half broken.
 */
export function normaliseVariants(list, { factId, existing = [], random = Math.random } = {}) {
  const out = [];
  const seen = new Set(existing.map(variantKey));
  for (const raw of Array.isArray(list) ? list : []) {
    const variant = normaliseVariant(raw, factId, random);
    if (!variant) continue;
    const key = variantKey(variant);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(variant);
  }
  return out;
}

export function variantKey(variant) {
  return [variant.type, variant.front || variant.prompt || variant.statement || variant.text || '', JSON.stringify(variant.choices || [])].join('|');
}

export function normaliseVariant(raw, factId, random = Math.random) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || raw.kind || '').trim();
  const base = { id: safeId(raw.id || newId('v', random)), factId, type };
  const text = (value) => String(value === undefined || value === null ? '' : value).trim();
  switch (type) {
    case 'flashcard': {
      const front = text(raw.front || raw.prompt);
      const back = text(raw.back || raw.answer);
      if (!front || !back) return null;
      return { ...base, front: front.slice(0, 300), back: back.slice(0, 600) };
    }
    case 'multiple-choice': {
      const prompt = text(raw.prompt || raw.question || raw.front);
      const choices = (Array.isArray(raw.choices) ? raw.choices : []).map(text).filter(Boolean).slice(0, 6);
      if (!prompt || choices.length < 2) return null;
      let answer = raw.answer;
      if (typeof answer === 'string') {
        const i = choices.findIndex((c) => c === answer);
        answer = i >= 0 ? i : Number(answer);
      }
      answer = Number(answer);
      if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) return null;
      return { ...base, prompt: prompt.slice(0, 400), choices, answer, why: text(raw.why || raw.explanation).slice(0, 600) };
    }
    case 'true-false': {
      const statement = text(raw.statement || raw.prompt || raw.front);
      if (!statement) return null;
      let answer = raw.answer;
      if (typeof answer === 'string') {
        const value = answer.trim().toLowerCase();
        if (['true', 'yes', 't', '1'].includes(value)) answer = true;
        else if (['false', 'no', 'f', '0'].includes(value)) answer = false;
      }
      if (typeof answer !== 'boolean') return null;
      return { ...base, statement: statement.slice(0, 400), answer, why: text(raw.why).slice(0, 600) };
    }
    case 'cloze': {
      // Either a template with {blank} or a full sentence plus the blank word.
      const rawText = text(raw.text || raw.prompt);
      const blank = text(raw.blank || raw.answer);
      if (!rawText) return null;
      const template = rawText.includes('___') || rawText.includes('{blank}') ? rawText.replace('{blank}', '___') : blank ? rawText.replace(new RegExp(escapeRe(blank), 'i'), '___') : '';
      if (!template.includes('___')) return null;
      const answer = blank || (rawText.match(/\{(.+?)\}/) || [])[1];
      if (!answer) return null;
      const bank = (Array.isArray(raw.bank) ? raw.bank : []).map(text).filter(Boolean).slice(0, 8);
      return { ...base, text: template.slice(0, 600), answer: answer.slice(0, 120), bank };
    }
    case 'order': {
      const items = (Array.isArray(raw.items) ? raw.items : []).map(text).filter(Boolean);
      if (items.length < 3 || items.length > 8) return null;
      return { ...base, prompt: text(raw.prompt).slice(0, 300), items };
    }
    case 'match': {
      const pairs = (Array.isArray(raw.pairs) ? raw.pairs : [])
        .map((p) => ({ term: text(p.term), meaning: text(p.meaning) }))
        .filter((p) => p.term && p.meaning)
        .slice(0, 8);
      if (pairs.length < 3) return null;
      return { ...base, pairs };
    }
    case 'spot-mistake': {
      const claims = (Array.isArray(raw.claims) ? raw.claims : []).map(text).filter(Boolean).slice(0, 5);
      if (claims.length < 2) return null;
      let wrong = Number(raw.wrong);
      if (!Number.isInteger(wrong) || wrong < 0 || wrong >= claims.length) return null;
      return { ...base, prompt: text(raw.prompt).slice(0, 300), claims, wrong, why: text(raw.why).slice(0, 600) };
    }
    case 'swipe': {
      const statement = text(raw.statement || raw.prompt || raw.front);
      if (!statement) return null;
      return { ...base, statement: statement.slice(0, 400), answer: Boolean(raw.answer) };
    }
    case 'voice':
    case 'teach-back': {
      const prompt = text(raw.prompt || raw.front);
      if (!prompt) return null;
      const points = (Array.isArray(raw.points) ? raw.points : []).map(text).filter(Boolean).slice(0, 8);
      return { ...base, prompt: prompt.slice(0, 400), points };
    }
    case 'scenario': {
      const prompt = text(raw.prompt || raw.situation);
      if (!prompt) return null;
      return { ...base, prompt: prompt.slice(0, 600), answer: text(raw.answer || raw.model).slice(0, 800) };
    }
    case 'listen': {
      const transcript = text(raw.transcript || raw.text);
      if (!transcript) return null;
      const question = text(raw.question || raw.prompt);
      const choices = (Array.isArray(raw.choices) ? raw.choices : []).map(text).filter(Boolean).slice(0, 4);
      let answer = Number(raw.answer);
      if (!question || choices.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= choices.length) return null;
      return { ...base, transcript: transcript.slice(0, 1200), question: question.slice(0, 300), choices, answer };
    }
    default:
      return null;
  }
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does the fact have enough variants (3 or more, the spec's minimum)? */
export function variantsComplete(fact) {
  return Array.isArray(fact.variants) && fact.variants.length >= MIN_VARIANTS;
}

/** Fact counts for the review screen and the pack header. */
export function summarisePack(topics, facts) {
  const counts = new Map(topics.map((topic) => [topic.id, 0]));
  for (const fact of facts) counts.set(fact.topicId, (counts.get(fact.topicId) || 0) + 1);
  return {
    topics: topics.length,
    facts: facts.length,
    needsCheck: facts.filter((f) => f.check).length,
    byTopic: [...counts].map(([topicId, count]) => ({ topicId, count })),
  };
}

// ------------------------------------------------------------- data hygiene

/** A fact below this confidence is flagged for a human look. */
export const REVIEW_CONFIDENCE = 0.5;

/** Does the fact name where it came from? A chunk anchor counts as a source. */
export function hasSource(fact = {}) {
  const source = fact.source || fact.anchor || null;
  if (source) {
    if (source.name || source.file || source.url) return true;
    if (source.page !== undefined && source.page !== null && source.page !== '') return true;
  }
  if (fact.sourceId || fact.chunkId) return true;
  return false;
}

/** Confidence as a number, or null when the fact does not carry one. */
export function confidenceOf(fact = {}) {
  const n = Number(fact.confidence);
  return Number.isFinite(n) ? n : null;
}

/**
 * Why a fact needs a human look, as a list of codes: `'no-source'` when no
 * citation is attached, `'low-confidence'` when confidence is under 0.5.
 * An empty list means the fact is fine. Pure and order stable.
 */
export function reviewReasons(fact = {}) {
  const reasons = [];
  if (!hasSource(fact)) reasons.push('no-source');
  const confidence = confidenceOf(fact);
  if (confidence !== null && confidence < REVIEW_CONFIDENCE) reasons.push('low-confidence');
  return reasons;
}

export function needsReview(fact = {}) {
  return reviewReasons(fact).length > 0;
}

/**
 * Every fact that needs a human look, with its reasons and topic title:
 * `{count, byReason: {no-source, low-confidence}, items: [{id, topicId, title, statement, reasons}]}`.
 */
export function reviewQueue(facts = [], topics = []) {
  const titles = new Map((topics || []).map((topic) => [topic.id, topic.title]));
  const items = [];
  const byReason = { 'no-source': 0, 'low-confidence': 0 };
  for (const fact of facts || []) {
    const reasons = reviewReasons(fact);
    if (!reasons.length) continue;
    for (const reason of reasons) byReason[reason] += 1;
    items.push({
      id: fact.id,
      topicId: fact.topicId || null,
      title: titles.get(fact.topicId) || '',
      statement: String(fact.statement || fact.text || ''),
      reasons,
    });
  }
  return { count: items.length, byReason, items };
}
