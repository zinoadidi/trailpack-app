// Prompts for the model tasks, and the pure helpers that read what comes back.
//
// Rules (SPEC.md, API.md): every call goes through the backend with a `task`,
// the model writes JSON (`json:true`), and nothing here invents a fact that the
// source does not support. Prompt text never contains anything private: it is
// built from the user's own pack (chunks, facts) which stays on their account.
//
// Batching: one `ingest_map` call per few chunks (the response cap is 8,000
// tokens and the prompt cap 60,000 characters), and one `generate` call per few
// facts, so a big document finishes in a few seconds instead of one huge call.

export const LIMITS = {
  promptChars: 60000,
  responseTokens: 4000,
  chunksPerMapCall: 3,
  factsPerGenerateCall: 5,
};

// ---------------------------------------------------------------- parsing

/**
 * Read JSON from a model reply. Handles a fenced code block and leading or
 * trailing prose, which smaller models add even when asked not to. Returns
 * null when nothing parseable is there, so the caller can fall back to a
 * smaller batch instead of storing junk.
 */
export function parseJsonReply(text) {
  if (text && typeof text === 'object') return text;
  let raw = String(text || '').trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  const attempt = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };
  const direct = attempt(raw);
  if (direct !== undefined) return direct;
  // Take the outermost {...} or [...] that parses.
  const starts = [raw.indexOf('{'), raw.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const open = raw[start];
  const close = open === '{' ? '}' : ']';
  const end = raw.lastIndexOf(close);
  if (end <= start) return null;
  const sliced = attempt(raw.slice(start, end + 1));
  return sliced === undefined ? null : sliced;
}

/** Split a list into batches of at most `size`. */
export function batches(list, size) {
  const out = [];
  const items = Array.isArray(list) ? list : [];
  const n = Math.max(1, Math.floor(size) || 1);
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * Keep a prompt under the gateway's 60,000 character cap by dropping chunks
 * from the end of the batch. Returns the prompt and how many chunks were used.
 */
export function fitPrompt(build, chunks) {
  let use = chunks.slice();
  let prompt = build(use);
  while (prompt.length > LIMITS.promptChars && use.length > 1) {
    use = use.slice(0, use.length - 1);
    prompt = build(use);
  }
  if (prompt.length > LIMITS.promptChars) prompt = prompt.slice(0, LIMITS.promptChars);
  return { prompt, used: use.length };
}

// ---------------------------------------------------------------- ingest

const MAP_SYSTEM = [
  'You turn study material into a Pack for a spaced repetition app.',
  'Reply with JSON only, no prose, no code fence.',
  'Ground every fact in the text you are given. Never add outside knowledge.',
  'If the text is uncertain or contradicts itself, lower confidence and say so in why.',
].join(' ');

function mapInstructions(chunkIds) {
  return [
    'Group the passages into 1 to 6 topics. Each topic needs an id (short, lowercase, dashes), a title and a one sentence summary.',
    'Each fact is one atomic, testable statement, 8 to 40 words, that someone could be asked to recall. Split compound sentences.',
    'Assign each fact the chunk_id of the passage it came from, one of: ' + chunkIds.join(', ') + '.',
    'importance is 1 to 5 (5 = core idea). confidence is 0 to 1: how sure you are the text supports the fact.',
    'Skip page numbers, headers, table of contents lines and anything that is not a claim.',
    'Shape: {"topics":[{"id":"t1","title":"...","summary":"...","facts":[{"id":"f1","statement":"...","chunk_id":"...","importance":3,"confidence":0.9}]}]}',
  ].join('\n');
}

/**
 * One `ingest_map` request: passages in, topics and facts out.
 * @param {Array<{id: string, page: number, text: string}>} chunks
 * @param {{title?: string, goal?: string, lang?: string}} pack
 */
export function mapMessages(chunks, pack = {}) {
  const ids = chunks.map((c) => c.id);
  const body = chunks
    .map((c) => `<passage id="${c.id}" page="${c.page}">\n${c.text}\n</passage>`)
    .join('\n\n');
  const context = [pack.title ? 'Pack: ' + pack.title : '', pack.goal ? 'Goal: ' + pack.goal : '', pack.lang ? 'Write in this language: ' + pack.lang : '']
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: MAP_SYSTEM },
    { role: 'user', content: [context, mapInstructions(ids), body].filter(Boolean).join('\n\n') },
  ];
}

export function mapRequest(chunks, pack = {}) {
  const { prompt, used } = fitPrompt(() => JSON.stringify(mapMessages(chunks, pack)), chunks);
  // fitPrompt measures the messages, so rebuild the final messages from `used`.
  const messages = mapMessages(chunks.slice(0, used), pack);
  void prompt;
  return { task: 'ingest_map', json: true, maxTokens: LIMITS.responseTokens, messages, chunkCount: used };
}

// ---------------------------------------------------------------- variants

const VARIANT_SYSTEM = 'You write study exercises. Reply with JSON only, no prose, no code fence.';

/** What each format asks for, so the reply can be validated by pack.js. */
export const VARIANT_SHAPES = {
  flashcard: '{"type":"flashcard","front":"question","back":"answer under 40 words"}',
  'multiple-choice': '{"type":"multiple-choice","prompt":"question","choices":["4 options"],"answer":0,"why":"one line that teaches"}',
  'true-false': '{"type":"true-false","statement":"a claim","answer":true,"why":"one line"}',
  cloze: '{"type":"cloze","text":"a sentence with ___ where the word goes","answer":"the word"}',
  order: '{"type":"order","prompt":"Put these in order","items":["3 to 8 steps in the correct order"]}',
  match: '{"type":"match","pairs":[{"term":"...","meaning":"..."},{"term":"...","meaning":"..."},{"term":"...","meaning":"..."}]}',
  'spot-mistake': '{"type":"spot-mistake","prompt":"Which claim is wrong?","claims":["2 to 5 claims, exactly one wrong"],"wrong":1,"why":"one line"}',
  'teach-back': '{"type":"teach-back","prompt":"Explain it in your own words","points":["what a good answer must cover"]}',
  voice: '{"type":"voice","prompt":"Say it out loud","points":["key points to cover"]}',
  listen: '{"type":"listen","transcript":"2 sentences to hear","question":"...","choices":["2 to 4 options"],"answer":0}',
};

export const DEFAULT_VARIANTS = ['flashcard', 'multiple-choice', 'true-false'];

/**
 * One `generate` request for a batch of facts. Each fact must come back with a
 * spread of formats: at least one recognition, one production and one other,
 * so the Mixer has variety without seeing the same shape every time.
 */
export function generateMessages(facts, { types = DEFAULT_VARIANTS, lens = null, lang } = {}) {
  const factsBlock = facts
    .map((f) => `<fact id="${f.id}">${f.statement}</fact>`)
    .join('\n');
  const wanted = types.filter((t) => VARIANT_SHAPES[t]);
  const shapes = wanted.map((t) => '- ' + VARIANT_SHAPES[t]).join('\n');
  const instructions = [
    `For each fact, write ${Math.max(3, wanted.length)} variants, one of each type: ${wanted.join(', ')}.`,
    'Distractors in multiple choice must be plausible and wrong; never "all of the above".',
    'A true-false statement is false about half the time: reword the fact so it is wrong.',
    'Shape: {"variants":{"<fact id>":[{...}]}} or an array {"variants":[{...,"fact_id":"<fact id>"}]}',
    'Use exactly the shapes below:',
    shapes,
  ];
  if (lens) {
    if (lens.difficulty) instructions.push('Difficulty: ' + lens.difficulty + '.');
    if (lens.tone) instructions.push('Tone: ' + lens.tone + '.');
    if (Array.isArray(lens.emphasis) && lens.emphasis.length) instructions.push('Emphasise: ' + lens.emphasis.join(', ') + '.');
  }
  if (lang) instructions.push('Write in this language: ' + lang + '.');
  return [
    { role: 'system', content: VARIANT_SYSTEM },
    { role: 'user', content: factsBlock + '\n\n' + instructions.join('\n') },
  ];
}

export function generateRequest(facts, opts = {}) {
  const { used } = fitPrompt(() => JSON.stringify(generateMessages(facts, opts)), facts);
  const chosen = facts.slice(0, used);
  return {
    task: 'generate',
    json: true,
    maxTokens: Math.min(8000, 600 * Math.max(1, chosen.length)),
    messages: generateMessages(chosen, opts),
    factIds: chosen.map((f) => f.id),
  };
}

/**
 * Read a generate reply into `[{factId, variants}]`. Accepts both shapes the
 * model may produce: an object keyed by fact id, or a flat array with
 * `fact_id`. Variants with no recognisable fact id are dropped.
 */
export function readGenerateReply(reply, factIds) {
  const known = new Set(factIds);
  const out = [];
  const seen = new Set();
  const push = (factId, variants) => {
    if (!factId || !known.has(factId) || seen.has(factId)) return;
    seen.add(factId);
    out.push({ factId, variants: Array.isArray(variants) ? variants : [] });
  };
  const body = reply && reply.variants !== undefined ? reply.variants : reply;
  if (Array.isArray(body)) {
    for (const item of body) {
      if (!item || typeof item !== 'object') continue;
      const id = item.fact_id || item.factId;
      push(id, [item]);
    }
  } else if (body && typeof body === 'object') {
    for (const [factId, variants] of Object.entries(body)) push(factId, variants);
  }
  return out;
}

// ---------------------------------------------------------------- scoring

/** `score` task (voice answers, scenarios): coverage of expected points. */
export function scoreMessages({ prompt, expected = [], answer, lang }) {
  return [
    {
      role: 'system',
      content: 'You grade a spoken or written answer against expected points. Reply with JSON only: {score: 0 to 1, missed: ["expected points not covered"], comment: "one teaching sentence"}.',
    },
    {
      role: 'user',
      content: [
        prompt ? 'Question: ' + prompt : '',
        expected.length ? 'Expected points:\n- ' + expected.join('\n- ') : '',
        'Answer: ' + answer,
        lang ? 'Write the comment in this language: ' + lang : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

/** `teach` task: the learner explains a topic; list what they missed. */
export function teachMessages({ topic, facts = [], answer, lang }) {
  return [
    {
      role: 'system',
      content: 'You check an explanation against a list of facts. Reply with JSON only: {coverage: 0 to 1, missed: ["fact ids or short phrases not explained"], helpful: "one encouraging, specific sentence"}.',
    },
    {
      role: 'user',
      content: [
        'Topic: ' + topic,
        'Facts the explanation should cover:\n' + facts.map((f) => '- [' + f.id + '] ' + f.statement).join('\n'),
        'Explanation: ' + answer,
        lang ? 'Write helpful in this language: ' + lang : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

/** Normalise a score/teach reply to `{score, missed, comment}` with safe bounds. */
export function readScoreReply(reply) {
  const body = reply && typeof reply === 'object' ? reply : {};
  const raw = body.score !== undefined ? body.score : body.coverage;
  const n = Number(raw);
  const score = Number.isFinite(n) ? Math.min(1, Math.max(0, n > 1 ? n / 100 : n)) : null;
  return {
    score,
    missed: (Array.isArray(body.missed) ? body.missed : []).map((m) => String(m)).filter(Boolean).slice(0, 12),
    comment: String(body.comment || body.helpful || '').slice(0, 600),
  };
}
