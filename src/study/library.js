// Library: how extracted documents become a Pack, and the review decisions
// between "read" and "frozen". Pure functions over plain objects, so the
// ingest flow in the screen can be tested without a DOM, IndexedDB or network.
//
// The pipeline (SPEC M2) is:
//   file or pasted text -> extract text -> chunk -> map (ingest_map) -+
//                       -> generate variants (generate, after freeze) |
//   review (topics, facts, merge, rename, drop) -> freeze -> Pack -----+
//
// Shapes:
//   source  {id, name, type, size, fileId?, at, pages, words, state, error?}
//           state: 'reading' | 'reading-failed' | 'mapping' | 'mapped' | 'mapping-failed' | 'variant-failed'
//   pack    {id, title, goal, kind, status: 'draft'|'frozen', lensDefault,
//            sources: [source], review: {generatedAt, model, warned} | null,
//            createdAt, updatedAt}
//
// The source text itself lives in the `files` store (blob) and is stored on the
// server with `/sync/files`, so a Pack doc stays far under the 1 MB limit.

import { chunkDocument, countWords, DEFAULT_CHUNK } from './chunker.js';
import { normaliseMap, mergeIntoPack, applyReviewEdits, summarisePack, safeId } from './pack.js';
import { batches, LIMITS, readGenerateReply } from './prompts.js';

/** Files the real backend extracts and the mock can read (mock: txt, md, html). */
export const ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'pptx', 'txt', 'md', 'markdown', 'html', 'htm', 'eml', 'png', 'jpg', 'jpeg', 'webp'];

/**
 * What the file picker and the drop zone accept. Kept here so a test can check
 * it matches what the pipeline can name.
 */
/** Human readable list of accepted types for help text: "PDF, DOCX or TEXT". */
export const extensions = ACCEPTED_EXTENSIONS.filter((ext) => ext !== 'htm' && ext !== 'markdown')
  .map((ext) => ext.toUpperCase())
  .join(', ');

export function acceptAttribute() {
  const types = ACCEPTED_EXTENSIONS.map((ext) => '.' + ext);
  types.push('text/plain', 'text/markdown', 'text/html', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp');
  return types.join(',');
}

/** File extension, lower case, without the dot. */
export function extensionOf(name) {
  const value = String(name || '').trim();
  const dot = value.lastIndexOf('.');
  if (dot < 0 || dot === value.length - 1) return '';
  return value.slice(dot + 1).toLowerCase();
}

/**
 * Can this file go through `/ingest/extract`? A file with no extension but a
 * text mime type is treated as text.
 */
export function isAccepted(name, type = '') {
  const ext = extensionOf(name);
  if (ACCEPTED_EXTENSIONS.includes(ext) || ext === 'markdown') return true;
  if (!ext && /^text\//.test(String(type))) return true;
  return false;
}

/** A short reason key for a file the pipeline cannot read. */
export function rejectReason(name, type = '') {
  if (isAccepted(name, type)) return null;
  return 'ingest.unsupported';
}

export function sourceId(name, random = Math.random) {
  return safeId('src_' + (String(name || 'text').replace(/\.[A-Za-z0-9]+$/, '') || 'text'), 'src_text') + '_' + Math.floor(random() * 36 ** 6).toString(36);
}

/** A fresh Pack in draft state. Neutral defaults only. */
export function newPack({ title = '', goal = '', kind = 'other', lang = 'en', random = Math.random } = {}) {
  const now = new Date().toISOString();
  return {
    id: safeId('pack_' + (title || 'untitled'), 'pack') + '_' + Math.floor(random() * 36 ** 6).toString(36),
    title: String(title || '').slice(0, 160),
    goal: String(goal || '').slice(0, 300),
    kind,
    lang,
    status: 'draft',
    lensDefault: null,
    sources: [],
    review: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** A source record while it is still being read. */
export function newSource({ id, name, type, size, fileId, now = Date.now() }) {
  return {
    id,
    name: String(name || 'text').slice(0, 200),
    type: String(type || 'text/plain'),
    size: Math.max(0, Number(size) || 0),
    fileId: fileId || null,
    at: new Date(now).toISOString(),
    pages: 0,
    words: 0,
    state: 'reading',
  };
}

/** Move a source to a new state, keeping the previous error when none is given. */
export function setSourceState(pack, sourceId, state, patch = {}) {
  const sources = (pack.sources || []).map((source) => (source.id === sourceId ? { ...source, ...patch, state, error: patch.error ?? null } : source));
  return { ...pack, sources, updatedAt: new Date().toISOString() };
}

/** Remove a source and report the pack without it. */
export function removeSource(pack, sourceId) {
  return { ...pack, sources: (pack.sources || []).filter((source) => source.id !== sourceId), updatedAt: new Date().toISOString() };
}

/**
 * Chunk one extracted document. `pages` come from `/ingest/extract`
 * (`[{n, text}]`); a plain `text` is treated as one page.
 */
export function chunksForSource(source, extraction, limits = DEFAULT_CHUNK, { preservePages = false } = {}) {
  const pages = Array.isArray(extraction && extraction.pages) && extraction.pages.length ? extraction.pages : [{ n: 1, text: (extraction && extraction.text) || '' }];
  const doc = { pages: pages.map((page) => ({ n: Number(page.n) || 1, text: String(page.text || '') })) };
  if (preservePages) return doc.pages.flatMap((page) => chunkDocument({ pages: [page] }, { sourceId: source.id, limits }));
  return chunkDocument(doc, { sourceId: source.id, limits });
}

/** Word count of an extraction, from the reply when it is there. */
export function wordsOf(extraction) {
  const meta = extraction && extraction.meta;
  if (meta && Number.isFinite(meta.words)) return meta.words;
  return countWords((extraction && extraction.text) || '');
}

// ------------------------------------------------------------------ mapping

/** Which chunks still need a map call, in batches under the prompt cap. */
export function mapBatches(chunks, size = LIMITS.chunksPerMapCall) {
  return batches(chunks, size);
}

/**
 * Fold one `ingest_map` reply into the pack's review state.
 * `state` is `{topics, facts, warnings}` as built by `normaliseMap`.
 */
export function applyMapReply(state, reply, { packId, chunks }) {
  const mapped = normaliseMap(reply, { packId, chunks });
  const { added, skipped } = mergeIntoPack(state.facts || [], mapped.facts);
  return {
    topics: [...(state.topics || []), ...mapped.topics],
    facts: [...(state.facts || []), ...added],
    warnings: [
      ...(state.warnings || []),
      ...mapped.warnings,
      ...skipped.map((fact) => ({ code: 'duplicate', statement: fact.statement })),
    ],
  };
}

/**
 * Merge mapped topics and facts into a Draft for the review screen, so the same
 * topic title from two documents (or two batches) becomes one topic.
 */
export function foldTopics(topics, facts) {
  const byTitle = new Map();
  const remap = new Map();
  const outTopics = [];
  for (const topic of topics) {
    const key = String(topic.title || '').trim().toLowerCase();
    const hit = key ? byTitle.get(key) : null;
    if (hit) {
      remap.set(topic.id, hit.id);
      if (!hit.summary && topic.summary) hit.summary = topic.summary;
      continue;
    }
    const copy = { ...topic, order: outTopics.length };
    outTopics.push(copy);
    if (key) byTitle.set(key, copy);
  }
  const outFacts = facts.map((fact) => ({ ...fact, topicId: remap.get(fact.topicId) || fact.topicId }));
  return { topics: outTopics, facts: outFacts };
}

/** The review screen's counts plus the warnings a human should read first. */
export function reviewSummary(topics, facts) {
  const base = summarisePack(topics, facts);
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const unsourced = facts.filter((fact) => !fact.chunkId).length;
  const lowConfidence = facts.filter((fact) => Number(fact.confidence) < 0.5).length;
  return {
    ...base,
    unsourced,
    lowConfidence,
    byTopic: base.byTopic.map((row) => ({ ...row, title: (topicById.get(row.topicId) || {}).title || '' })),
  };
}

/** Apply the review edits (rename, merge, drop) and return the frozen-safe lists. */
export function applyEdits(topics, facts, edits) {
  const applied = applyReviewEdits(topics, edits, facts);
  return foldTopics(applied.topics, applied.facts);
}

/**
 * Can the draft be frozen? A Pack needs a title and at least one fact; low
 * confidence facts are allowed but the screen warns about them.
 */
export function canFreeze(pack, topics, facts) {
  const problems = [];
  if (!String(pack.title || '').trim()) problems.push('freeze.needsTitle');
  if (!topics.length) problems.push('freeze.needsTopic');
  if (!facts.length) problems.push('freeze.needsFacts');
  return { ok: problems.length === 0, problems };
}

/**
 * Freeze: build the stored docs. Facts keep the review edits; every fact is
 * tagged `check` when it is low confidence so gates can skip it until a human
 * confirms it. Progress is never part of this object.
 */
export function freezePack(pack, topics, facts, { model = null, now = new Date().toISOString() } = {}) {
  const keptTopics = topics.map((topic, order) => ({ ...topic, packId: pack.id, order }));
  const keptFacts = facts.map((fact) => ({
    ...fact,
    packId: pack.id,
    check: fact.check || (Number(fact.confidence) < 0.5 ? 1 : 0),
    variants: Array.isArray(fact.variants) ? fact.variants : [],
    createdAt: fact.createdAt || now,
  }));
  const frozen = {
    ...pack,
    status: 'frozen',
    review: { generatedAt: now, model },
    frozenAt: now,
    updatedAt: now,
  };
  return { pack: frozen, topics: keptTopics, facts: keptFacts };
}

/**
 * Adding documents later: merge the new facts without touching what is stored.
 * Facts already in the Pack (same statement) are skipped, and every new fact
 * keeps its own id so any later progress is attached to the right claim.
 */
export function mergeDocument(storeFacts, incomingFacts) {
  const result = mergeIntoPack(storeFacts, incomingFacts);
  return {
    facts: [...storeFacts, ...result.added],
    added: result.added.length,
    skipped: result.skipped.length,
  };
}

/** "+18 facts, about 2 more bites a day" (design 3.10), as numbers. */
export function addLoadEstimate({ added, stepsPerBite = 8, factsPerStep = 1.5 }) {
  const facts = Math.max(0, Math.floor(Number(added) || 0));
  const bites = facts ? Math.max(1, Math.ceil(facts / Math.max(1, stepsPerBite * factsPerStep))) : 0;
  return { facts, bites };
}

// ---------------------------------------------------------------- variants

/** Facts that still have fewer than three variants, in generate batches. */
export function factsNeedingVariants(facts, size = LIMITS.factsPerGenerateCall) {
  const missing = (facts || []).filter((fact) => !Array.isArray(fact.variants) || fact.variants.length < 3);
  return batches(missing, size);
}

/**
 * Read a generate reply into per fact variants, using the request's fact ids
 * so a reply that renames ids cannot attach a card to the wrong fact.
 */
export function variantsFromReply(reply, requestedIds) {
  const rows = readGenerateReply(reply, requestedIds);
  return rows.map((row) => ({ factId: row.factId, variants: row.variants }));
}

/** Does every fact have three or more variants yet? */
export function variantsProgress(facts) {
  const list = facts || [];
  const done = list.filter((fact) => Array.isArray(fact.variants) && fact.variants.length >= 3).length;
  return { done, total: list.length, complete: list.length > 0 && done === list.length };
}
