// Ingest and LLM gateway stubs for local development.
// Deterministic output, no network, no real provider keys.

import { HttpError, send } from './mock-lib.mjs';
import { usageToday } from './mock-me.mjs';

const MODELS = [
  { id: 'muse', label: 'Muse', available: true },
  { id: 'deepseek-flash', label: 'DeepSeek Flash', available: true },
];

export async function handleModels(data, res) {
  send(res, 200, { default: 'muse', models: MODELS });
}

/** Very small text extraction: txt, md, html stripped of tags. */
export async function handleExtract(data, req, res, bytes) {
  if (bytes.length > 20 * 1024 * 1024) throw new HttpError(413, 'too_large');
  const name = decodeURIComponent(req.headers['x-file-name'] || 'file');
  const type = req.headers['content-type'] || 'text/plain';
  const kind = name.split('.').pop().toLowerCase();
  // Pasted text is stored and read as text/plain but named "<n>.text", so the
  // extension is not the type to trust: text/plain always reads as text.
  if (!['txt', 'md', 'html', 'htm'].includes(kind) && !String(type).startsWith('text/')) {
    throw new HttpError(415, 'unsupported_type', 'The mock API reads txt, md and html. Use the real backend for other types.');
  }
  let text = new TextDecoder().decode(bytes);
  if (kind === 'html' || kind === 'htm') text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const pages = [{ n: 1, text }];
  send(res, 200, {
    text,
    pages,
    meta: { type: kind === 'md' ? 'md' : kind === 'html' || kind === 'htm' ? 'html' : 'txt', pages: 1, words: text.split(/\s+/).filter(Boolean).length },
  });
}

const MOCK_REPLIES = {
  ingest_map: {
    topics: [
      {
        id: 't_example',
        title: 'Getting started',
        summary: 'What you need to know first, from the mock API.',
        facts: [
          { id: 'f_example_1', statement: 'A project has a start, a scope and a finish date.', importance: 3, confidence: 1 },
          { id: 'f_example_2', statement: 'A milestone marks a single point in time, not a period of work.', importance: 3, confidence: 1 },
        ],
      },
    ],
  },
  // The variants go back keyed by the fact ids the request asked for, which is
  // the shape `readGenerateReply` reads. Same three shapes for every fact, so
  // the mixer has a flashcard, a multiple choice and a true or false to pick.
  generate: {
    variants: {
      f_example_1: [
        { type: 'flashcard', front: 'What does a project need before it starts?', back: 'A start, a scope and a finish date.' },
        { type: 'multiple-choice', prompt: 'What does a project need before it starts?', choices: ['A start, a scope and a finish date', 'Only a budget', 'A person and a desk', 'Nothing at all'], answer: 0, why: 'Start, scope and finish date are the three basics.' },
        { type: 'true-false', statement: 'A project has a start, a scope and a finish date.', answer: true, why: 'Those three are what makes it a project.' },
        { type: 'cloze', text: 'A project has a start, a scope and a ___ date.', answer: 'finish' },
      ],
      f_example_2: [
        { type: 'flashcard', front: 'What does a milestone mark?', back: 'A single point in time, not a period of work.' },
        { type: 'multiple-choice', prompt: 'What does a milestone mark?', choices: ['A period of work', 'A single point in time', 'A budget', 'A person'], answer: 1, why: 'A milestone is a moment, not a stretch of work.' },
        { type: 'true-false', statement: 'A milestone covers a period of work.', answer: false, why: 'A milestone is one point in time.' },
        { type: 'cloze', text: 'A milestone marks a single point in ___.', answer: 'time' },
      ],
    },
  },
  score: { score: 0.75, missed: [], comment: 'Mock score.' },
  teach: { coverage: 0.7, missed: [], helpful: 'Mock feedback.' },
  lens: { diff: { difficulty: { from: 'medium', to: 'hard' } } },
  translate: { text: 'Mock translation.' },
  other: { text: 'Mock reply.' },
};

export async function handleChat(data, user, res, body) {
  const task = body.task || 'other';
  // Generate replies are keyed by the fact ids the request carried, which is
  // what `readGenerateReply` reads. The demo facts always come back as
  // f_example_1 / f_example_2, so the two demo ids map to them by position.
  const asked = Array.isArray(body.factIds) ? body.factIds : [];
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const promptChars = messages.reduce((n, m) => n + String(m.content || '').length, 0);
  if (promptChars > 60000) throw new HttpError(400, 'prompt_too_large');
  const usage = usageToday(data, user);
  const inputTokens = Math.ceil(promptChars / 4);
  const maxTokens = Math.min(8000, Number(body.maxTokens || 800));
  if (usage.tokensToday + inputTokens + maxTokens > usage.budgetToday) {
    send(res, 429, { error: 'budget_exceeded', message: 'Daily model budget reached', budget: usage });
    return;
  }
  const wanted = body.model && body.model !== 'auto' ? body.model : user.model === 'deepseek-flash' ? 'deepseek-flash' : 'muse';
  let payload = MOCK_REPLIES[task] || MOCK_REPLIES.other;
  if (task === 'generate') {
    const demo = ['f_example_1', 'f_example_2'];
    const variants = {};
    asked.forEach((id, index) => {
      const rows = MOCK_REPLIES.generate.variants[demo[index]] || MOCK_REPLIES.generate.variants[demo[0]];
      variants[id] = rows;
    });
    payload = { variants };
  }
  const text = body.json === false ? 'Mock reply.' : JSON.stringify(payload);
  const outputTokens = Math.ceil(text.length / 4);
  const day = new Date(data.now()).toISOString().slice(0, 10);
  data.usage.push({ userId: user.id, day, model: wanted, task, calls: 1, tokens: inputTokens + outputTokens });
  send(res, 200, {
    text,
    model: wanted,
    fallbackUsed: false,
    usage: { inputTokens, outputTokens },
    budget: { used: usage.tokensToday + inputTokens + outputTokens, limit: usage.budgetToday },
  });
}
