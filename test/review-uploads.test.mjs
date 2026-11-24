// Two review-screen behaviours a learner hit in the upload flow:
//
//   1. Choosing more files while one is still being read used to drop the
//      second selection without saying anything (`if (running) return`). Every
//      chosen file must be read, in order, and the queue must not grow a file
//      twice when the same pick is handed over again.
//   2. When the backend refuses a document it says why (`too_many_visual_pages`,
//      `invalid_image`, `vision_empty`, `provider_unavailable`, `timeout`).
//      The source row must show that reason, in all five languages, instead of
//      a generic failure.
//
// The real review screen runs against the small DOM in test/helpers/dom.mjs and
// a controllable in-memory API, so a click goes through the same code a browser
// would run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installDom, byText } from './helpers/dom.mjs';

installDom();
const { state, t, loadCatalogue, setLanguage } = await import('../src/app/state.js');
const { MemoryStore } = await import('../src/store/idb.js');
await loadCatalogue('en');
await setLanguage('en');

const PACK = {
  id: 'p1',
  title: 'Field Notes',
  status: 'draft',
  goal: 'Ship the small project',
  sources: [],
  created: '2026-01-01T00:00:00.000Z',
};

/** A store with one draft Pack and nothing else. */
function draftStore() {
  const store = new MemoryStore();
  store.put('docs', { rev: 1, deleted: 0, dirty: 0, collection: 'packs', id: 'p1', doc: structuredClone(PACK) });
  return store;
}

/** A File-shaped object: the screen only needs these four members. */
function fileOf(name, body = 'Hello world. This is a small document.') {
  const bytes = new TextEncoder().encode(body);
  return { name, type: 'text/plain', size: bytes.length, arrayBuffer: async () => bytes.buffer };
}

/**
 * A fake API that records every document read. The review screen builds its
 * ingest from `state.api`, so this is the seam a real upload goes through:
 * `extract` gets the bytes, `chat` answers the topic map.
 */
function fakeApi({ failWith = null } = {}) {
  const read = [];
  return {
    read,
    async extract(bytes, { name } = {}) {
      read.push(name);
      if (failWith) throw Object.assign(new Error(failWith.message || failWith.code), failWith);
      return { text: 'A milestone marks a point in time.' };
    },
    async chat() {
      return { text: JSON.stringify({ topics: [{ title: 'Basics', facts: [{ statement: 'A milestone marks a point in time.' }] }] }) };
    },
  };
}

async function openDraft(api) {
  state.user = { id: 'u1', studyLang: 'en' };
  state.sync = null;
  state.store = draftStore();
  state.api = api;
  location.hash = '#/library/review?id=p1';
  const review = (await import('../src/screens/review.js')).default;
  const view = review({ config: { allowRemote: true } });
  await view.mount();
  await new Promise((resolve) => setTimeout(resolve, 15));
  return view;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Uploads: files chosen while one is still reading are read afterwards, not dropped', async () => {
  const api = fakeApi();
  const view = await openDraft(api);
  const input = view.el.querySelectorAll('input[type="file"]')[0];
  assert.ok(input, 'the file input is on the screen');

  // One change event carrying two files: the screen handles them one by one.
  input.files = [fileOf('first.txt'), fileOf('second.txt')];
  input.dispatch('change');
  await wait(40);

  assert.deepEqual(api.read, ['first.txt', 'second.txt'], 'both chosen files are read, in order');
  view.destroy?.();
});

test('Uploads: a second selection during a read is queued and read next', async () => {
  const api = fakeApi();
  // Hold the first read open so the second pick arrives mid-read.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const original = api.extract;
  let first = true;
  api.extract = async (source, bytes) => {
    if (first) { first = false; await held; }
    return original(source, bytes);
  };

  const view = await openDraft(api);
  const input = view.el.querySelectorAll('input[type="file"]')[0];

  input.files = [fileOf('slow.txt')];
  input.dispatch('change');
  await wait(15);

  // The learner picks another file before the first one finished.
  input.files = [fileOf('while-busy.txt')];
  input.dispatch('change');
  release();
  await wait(60);

  assert.deepEqual(api.read, ['slow.txt', 'while-busy.txt'], 'the queued selection is read once the first finishes');
  view.destroy?.();
});

test('Uploads: the same files handed in twice by one pick are not queued twice', async () => {
  const api = fakeApi();
  const view = await openDraft(api);
  const input = view.el.querySelectorAll('input[type="file"]')[0];
  const same = fileOf('once.txt');
  input.files = [same];
  input.dispatch('change');
  // A second change event with the same pick (some browsers fire change twice).
  input.files = [same];
  input.dispatch('change');
  await wait(60);
  assert.deepEqual(api.read, ['once.txt'], 'one pick, one read');
  view.destroy?.();
});

test('Uploads: files queued while a paste is being read still run once it finishes', async () => {
  const api = fakeApi();
  const view = await openDraft(api);
  const input = view.el.querySelectorAll('input[type="file"]')[0];
  const pasteBox = view.el.querySelectorAll('textarea')[0];
  assert.ok(pasteBox, 'the paste box is on the screen');

  // Hold the paste's topic map open: reading a paste keeps the screen busy
  // through a different entry point than addFiles().
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let firstMap = true;
  const originalChat = api.chat;
  api.chat = async (...args) => {
    if (firstMap) { firstMap = false; await held; }
    return originalChat(...args);
  };

  pasteBox.value = 'Pasted: a milestone marks a point in time.';
  byText(view.el, t('library.pasteAdd'))[0].click();
  await wait(15);

  // The learner picks files while the paste is still being read.
  input.files = [fileOf('during-paste.txt')];
  input.dispatch('change');
  release();
  await wait(80);

  assert.ok(api.read.includes('during-paste.txt'), 'the file queued during the paste is read, not stranded');
  view.destroy?.();
});

test('Uploads: a file that cannot be read settles its job and the rest still run', async () => {
  const api = fakeApi();
  const view = await openDraft(api);
  const input = view.el.querySelectorAll('input[type="file"]')[0];

  const broken = {
    name: 'unreadable.txt',
    type: 'text/plain',
    size: 10,
    arrayBuffer: async () => { throw new Error('disk read failed'); },
  };
  input.files = [broken, fileOf('after-broken.txt')];
  input.dispatch('change');
  await wait(80);

  // The read after the broken file still happens, and the screen is usable.
  assert.deepEqual(api.read, ['after-broken.txt'], 'the file after the broken one is still read');
  assert.ok(view.el.textContent.includes(t('library.state.mapping-failed')) || view.el.textContent.includes(t('library.state.reading-failed')),
    'the broken file is marked failed, not left spinning');
  view.destroy?.();
});

test('Uploads: the change handler settles even when one file throws', async () => {
  const api = fakeApi();
  const view = await openDraft(api);
  const input = view.el.querySelectorAll('input[type="file"]')[0];
  const broken = { name: 'boom.txt', type: 'text/plain', size: 1, arrayBuffer: () => { throw new Error('sync boom'); } };

  // A rejected handler would become an unhandled rejection; the browser test
  // catches it here.
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    input.files = [broken];
    input.dispatch('change');
    await wait(60);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, [], 'no unhandled rejection escapes the screen');
  view.destroy?.();
});

// ------------------------------------------------------- source error details

const SOURCE_ERRORS = [
  { code: 'too_many_visual_pages', key: 'library.sourceError.too_many_visual_pages' },
  { code: 'invalid_image', key: 'library.sourceError.invalid_image' },
  { code: 'vision_empty', key: 'library.sourceError.vision_empty' },
  { code: 'provider_unavailable', key: 'library.sourceError.provider_unavailable' },
  { code: 'timeout', key: 'library.sourceError.timeout' },
];

test('Source errors: every backend reason has a message in all five languages', async () => {
  for (const lang of ['en', 'es', 'et', 'fi', 'fr']) {
    await loadCatalogue(lang);
    await setLanguage(lang);
    for (const { code, key } of SOURCE_ERRORS) {
      assert.ok(key in state.t.catalogue, `${lang} is missing ${key}`);
      assert.notEqual(t(key), key, `${lang} leaves ${key} untranslated`);
    }
  }
  await setLanguage('en');
});

test('Source errors: a refused document shows the backend reason, not a generic failure', async () => {
  for (const { code, key } of SOURCE_ERRORS) {
    const api = fakeApi({ failWith: { code, status: 422 } });
    const view = await openDraft(api);
    const input = view.el.querySelectorAll('input[type="file"]')[0];
    input.files = [fileOf('refused.pdf')];
    input.dispatch('change');
    await wait(50);
    const text = view.el.textContent;
    assert.ok(text.includes(t(key)), `${code}: the reason is shown`);
    assert.equal(text.includes(t('ingest.failed')), false, `${code}: no generic failure text instead`);
    const row = view.el.querySelectorAll('[role="status"]').find((node) => node.textContent.includes(t(key)));
    assert.ok(row, `${code}: the reason is announced to screen readers`);
    view.destroy?.();
  }
});

test('Source errors: an unknown code still says what happened and keeps the code', async () => {
  const api = fakeApi({ failWith: { code: 'brand_new_reason', status: 422 } });
  const view = await openDraft(api);
  const input = view.el.querySelectorAll('input[type="file"]')[0];
  input.files = [fileOf('odd.pdf')];
  input.dispatch('change');
  await wait(50);
  const text = view.el.textContent;
  assert.ok(text.includes(t('library.sourceError.unknown', { code: 'brand_new_reason' })), 'the unknown-reason line is shown');
  assert.ok(text.includes('brand_new_reason'), 'the raw code is kept for support');
  view.destroy?.();
});

test('Source errors: a failed source keeps its state chip and can be removed', async () => {
  const api = fakeApi({ failWith: { code: 'invalid_image' } });
  const view = await openDraft(api);
  const input = view.el.querySelectorAll('input[type="file"]')[0];
  input.files = [fileOf('broken.png')];
  input.dispatch('change');
  await wait(50);
  assert.ok(view.el.textContent.includes(t('library.state.reading-failed')), 'the chip still says it could not read');
  const remove = byText(view.el, t('common.remove'));
  assert.ok(remove.length > 0, 'the failed source can be removed');
  view.destroy?.();
});

test('Uploads: a failed read marks only its own file when two share a name', async () => {
  const api = fakeApi();
  const view = await openDraft(api);
  const input = view.el.querySelectorAll('input[type="file"]')[0];

  // Two different files with the same name from two folders; the second cannot
  // be read. Only the second may end up marked failed.
  const good = fileOf('notes.txt', 'First file contents.');
  const bad = { name: 'notes.txt', type: 'text/plain', size: 20, arrayBuffer: async () => { throw new Error('bad read'); } };
  input.files = [good, bad];
  input.dispatch('change');
  await wait(80);

  // Both sources exist (a failed read still records the source), and the good
  // one is mapped while the bad one is failed.
  const { loadPack } = await import('../src/study/store.js');
  const saved = await loadPack(state.store, 'p1');
  const rows = (saved.sources || []).filter((source) => source.name === 'notes.txt');
  assert.equal(rows.length, 2, 'both files are recorded');
  const states = rows.map((row) => row.state).sort();
  assert.deepEqual(states, ['mapped', 'reading-failed'], 'exactly one is failed, the other mapped');
  view.destroy?.();
});

test('Uploads: the draft write for a failed file finishes before the next file is read', async () => {
  const api = fakeApi();
  const view = await openDraft(api);
  const input = view.el.querySelectorAll('input[type="file"]')[0];

  // Record the order of draft writes and reads. The write that records the
  // failure must complete before the next file's read starts, or the two
  // writes can overwrite each other.
  const events = [];
  const { saveDraft } = await import('../src/study/store.js');
  const store = state.store;
  const put = store.put.bind(store);
  store.put = async (table, value) => {
    if (table === 'meta' && String(value.key || '').startsWith('draft-')) events.push('draft-write:start');
    const out = await put(table, value);
    if (table === 'meta' && String(value.key || '').startsWith('draft-')) events.push('draft-write:end');
    return out;
  };
  const extract = api.extract;
  api.extract = async (...args) => { events.push('read:' + args[1].name); return extract(...args); };

  const bad = { name: 'first.txt', type: 'text/plain', size: 5, arrayBuffer: async () => { throw new Error('bad read'); } };
  input.files = [bad, fileOf('second.txt')];
  input.dispatch('change');
  await wait(90);

  const badWriteEnd = events.indexOf('draft-write:end');
  const secondRead = events.indexOf('read:second.txt');
  assert.ok(badWriteEnd !== -1, 'the failure was written to the draft');
  assert.ok(secondRead !== -1, 'the second file was read');
  assert.ok(badWriteEnd < secondRead, `the failed-file write completed first (${events.join(', ')})`);
  view.destroy?.();
});
