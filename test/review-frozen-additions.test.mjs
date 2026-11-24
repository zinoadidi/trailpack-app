import test from 'node:test';
import assert from 'node:assert/strict';

class FakeNode {
  constructor(tag, text = '') {
    this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {};
    this.style = {}; this.dataset = {}; this._text = text; this.value = '';
    this.classList = { add() {}, remove() {} };
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  setAttribute(name, value) { this.attrs[name] = String(value); if (name === 'value') this.value = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  remove() {}
  focus() {}
  showModal() {}
  close() {}
  querySelector(selector) { return selector === '.btn.p' ? nodes(this).find((node) => node.className === 'btn p') : null; }
  click() { return this.listeners.click?.({ currentTarget: this, preventDefault() {} }); }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (text) => new FakeNode('#text', String(text)),
  getElementById: () => null,
  body: new FakeNode('body'),
};
globalThis.location = { hash: '#/library/review?id=p' };

const { state } = await import('../src/app/state.js');
const { MemoryStore } = await import('../src/store/idb.js');
const { createSyncEngine } = await import('../src/sync/engine.js');
const { savePack, saveTopic, saveFact, loadPackBundle, loadDraft, activePackId, loadReplacement } = await import('../src/study/store.js');
const { default: review } = await import('../src/screens/review.js');
const { default: library } = await import('../src/screens/library.js');
const { topicEditor } = await import('../src/screens/review-edit.js');

const nodes = (root) => [root, ...root.children.flatMap(nodes)];
const button = (root, label) => nodes(root).find((node) => node.tagName === 'BUTTON' && node.textContent === label);

async function fixture() {
  globalThis.location.hash = '#/library/review?id=p';
  const store = new MemoryStore();
  state.store = store; state.sync = null; state.t = null; state.user = {}; state.files = null;
  state.api = {
    extract: async () => ({ text: 'Plants capture energy from sunlight.', pages: [{ n: 1, text: 'Plants capture energy from sunlight.' }] }),
    chat: async () => ({ text: JSON.stringify({ topics: [{ id: 'fresh', title: 'Photosynthesis', facts: [{ id: 'f2', statement: 'Plants capture energy from sunlight.' }] }] }) }),
  };
  await savePack({ id: 'p', title: 'Pack', status: 'frozen', sources: [{ id: 's', name: 'Old', state: 'mapped' }] }, { store, sync: null });
  await saveTopic({ id: 't', packId: 'p', title: 'Topic', order: 0 }, { store, sync: null });
  await saveFact({ id: 'f', packId: 'p', topicId: 't', statement: 'Original fact here', confidence: 1, variants: [] }, { store, sync: null });
  return store;
}

test('frozen Pack allows an addition draft without changing the live bundle', async () => {
  const store = await fixture();
  const before = await loadPackBundle('p', store);
  const screen = review();
  await screen.mount();
  const add = button(screen.el, 'library.addMaterial');
  assert.ok(add);
  await add.click();
  assert.ok(button(screen.el, 'library.pickFiles'));
  assert.ok(button(screen.el, 'library.pasteAdd'));
  assert.ok((await loadDraft(store, 'p')).additionBase);
  assert.deepEqual(await loadPackBundle('p', store), before);
  const resumed = review();
  await resumed.mount();
  assert.ok(button(resumed.el, 'library.pasteAdd'));
});

test('removing an original fact from the draft affects only the replacement', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  const fact = nodes(screen.el).find((node) => node.className === 'fact-edit-row' && node.textContent.includes('Original fact here'));
  assert.ok(fact);
  await button(fact, 'review.removeFact').click();
  assert.equal((await loadPackBundle('p', store)).facts.length, 1);
  assert.equal((await loadDraft(store, 'p')).facts.some((item) => item.id === 'f'), false);
  await button(screen.el, 'library.createReplacement').click();
  const replacement = await loadPackBundle(await activePackId(store), store);
  assert.deepEqual(replacement.facts.map((item) => item.statement), ['Plants capture energy from sunlight.']);
  assert.equal((await loadPackBundle('p', store)).facts.length, 1);
});

test('editing a fact saves a corrected replacement without changing the original', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  const row = nodes(screen.el).find((node) => node.className === 'fact-edit-row' && node.textContent.includes('Original fact here'));
  assert.ok(row);
  button(row, 'review.editFact').click();
  const dialog = document.body.children.at(-1);
  nodes(dialog).find((node) => node.tagName === 'TEXTAREA').value = 'Corrected fact';
  await button(dialog, 'common.save').click();
  assert.equal((await loadPackBundle('p', store)).facts[0].statement, 'Original fact here');
  await button(screen.el, 'library.createReplacement').click();
  const replacement = await loadPackBundle(await activePackId(store), store);
  assert.equal(replacement.facts[0].statement, 'Corrected fact');
  assert.deepEqual(replacement.facts[0].variants, []);
});

test('existing topics cannot be edited away in addition mode', () => {
  const root = topicEditor({
    pack: { id: 'p', title: 'Pack', sources: [] },
    topics: [{ id: 'old', title: 'Old' }, { id: 'new', title: 'New' }],
    facts: [], protectedTopicIds: ['old'], additionMode: true,
  });
  const panels = nodes(root).filter((node) => node.className === 'panel stack');
  const old = panels.find((node) => node.textContent.includes('Old'));
  const fresh = panels.find((node) => node.textContent.includes('New'));
  assert.equal(button(old, 'review.drop'), undefined);
  assert.ok(button(fresh, 'review.drop'));
});

test('merging a new topic into an existing topic preserves existing facts', () => {
  const original = { id: 'f', topicId: 'old', statement: 'Original fact', variants: [{ id: 'v' }] };
  let changed;
  const root = topicEditor({
    pack: { id: 'p', title: 'Pack', sources: [] },
    topics: [{ id: 'old', title: 'Old' }, { id: 'new', title: 'New' }],
    facts: [original, { id: 'f2', topicId: 'new', statement: 'New fact' }],
    protectedTopicIds: ['old'], additionMode: true,
    onChange: (next) => { changed = next; },
  });
  const fresh = nodes(root).find((node) => node.className === 'panel stack' && node.textContent.includes('New'));
  button(fresh, 'review.merge').click();
  const dialog = document.body.children.at(-1);
  nodes(dialog).find((node) => node.tagName === 'SELECT').value = 'old';
  button(dialog, 'review.merge').click();
  assert.deepEqual(changed.facts.find((fact) => fact.id === 'f'), original);
  assert.equal(changed.facts.find((fact) => fact.id === 'f2').topicId, 'old');
  assert.deepEqual(changed.topics.map((topic) => topic.id), ['old']);
});

test('a pasted addition stays in the draft until approval', async () => {
  const store = await fixture();
  const before = await loadPackBundle('p', store);
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  const input = nodes(screen.el).find((node) => node.tagName === 'TEXTAREA');
  input.value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  const draft = await loadDraft(store, 'p');
  assert.ok(draft.additionBase);
  assert.equal(draft.pack.sources.length, 2);
  assert.equal(draft.facts.length, 2);
  assert.deepEqual(await loadPackBundle('p', store), before);
  assert.match(screen.el.textContent, /library\.replacementDraftHelp/);
  await button(screen.el, 'library.createReplacement').click();
  const after = await loadPackBundle('p', store);
  assert.equal(after.pack.status, 'frozen');
  assert.deepEqual(after, before);
  const replacement = await loadPackBundle(await activePackId(store), store);
  assert.equal(replacement.facts.length, 2);
  assert.ok(button(screen.el, 'library.keepBoth'));
  assert.ok(button(screen.el, 'library.checkOldDeletion'));
  assert.equal(button(screen.el, 'library.deleteOldPack'), undefined);
  assert.equal(await loadDraft(store, 'p'), null);
});

test('library shows the persisted replacement choice after reload, and keep both dismisses it', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  await button(screen.el, 'library.createReplacement').click();
  const libraryScreen = library();
  await libraryScreen.refresh();
  assert.ok(button(libraryScreen.el, 'library.keepBoth'));
  await button(libraryScreen.el, 'library.keepBoth').click();
  assert.ok(await loadPackBundle('p', store));
  assert.equal(await loadReplacement('p', store), null);
  const reloaded = library();
  await reloaded.refresh();
  assert.equal(button(reloaded.el, 'library.keepBoth'), undefined);
});

test('the newly created Pack can start its own addition draft before choosing what to do with the old Pack', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  await button(screen.el, 'library.createReplacement').click();
  const replacementId = await activePackId(store);
  await button(screen.el, 'library.addMaterial').click();
  assert.ok((await loadDraft(store, replacementId))?.additionBase);
});

test('deletion requires a separate confirmation and cancellation preserves both Packs', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  await button(screen.el, 'library.createReplacement').click();
  const replacementId = await activePackId(store);
  await button(screen.el, 'library.checkOldDeletion').click();
  const action = button(screen.el, 'library.deleteOldPack').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const dialog = document.body.children.at(-1);
  assert.match(dialog.textContent, /library\.deleteOldWarning/);
  button(dialog, 'common.cancel').click();
  await action;
  assert.ok(await loadPackBundle('p', store));
  assert.ok(await loadPackBundle(replacementId, store));
});

test('offline deletion check explains the block and leaves both Packs intact', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  await button(screen.el, 'library.createReplacement').click();
  state.sync = { sync: async () => ({ status: 'offline' }) };
  await button(screen.el, 'library.checkOldDeletion').click();
  assert.match(screen.el.textContent, /library\.replacementDeleteBlocked/);
  assert.equal(button(screen.el, 'library.deleteOldPack'), undefined);
  assert.ok(await loadPackBundle('p', store));
});

test('confirming deletion removes only the old Pack after eligibility is checked', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  await button(screen.el, 'library.createReplacement').click();
  const replacementId = await activePackId(store);
  await button(screen.el, 'library.checkOldDeletion').click();
  const action = button(screen.el, 'library.deleteOldPack').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const dialog = document.body.children.at(-1);
  button(dialog, 'library.deleteOldPack').click();
  await action;
  assert.equal(await loadPackBundle('p', store), null);
  assert.ok(await loadPackBundle(replacementId, store));
});

test('a failed addition draft save is visible and leaves the live Pack unchanged', async () => {
  const store = await fixture();
  const before = await loadPackBundle('p', store);
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  const put = store.put.bind(store);
  store.put = async (name, row) => {
    if (name === 'meta' && row.key === 'draft-p') throw new Error('storage full');
    return put(name, row);
  };
  const input = nodes(screen.el).find((node) => node.tagName === 'TEXTAREA');
  input.value = 'Text that remains in the editor after storage fails.';
  await button(screen.el, 'library.pasteAdd').click();
  assert.match(screen.el.textContent, /library\.additionSaveFailed/);
  assert.equal(input.value, 'Text that remains in the editor after storage fails.');
  assert.deepEqual(await loadPackBundle('p', store), before);
});

test('retrying a paste after a draft-save failure does not leave an unfinished source', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  const put = store.put.bind(store);
  let fail = true;
  store.put = async (name, row) => {
    if (fail && name === 'meta' && row.key === 'draft-p') { fail = false; throw new Error('storage full'); }
    return put(name, row);
  };
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  await button(screen.el, 'library.pasteAdd').click();
  const draft = await loadDraft(store, 'p');
  assert.equal(draft.pack.sources.length, 2);
  assert.equal(draft.pack.sources[1].state, 'mapped');
});

test('mapping failure remains visible in the draft without changing the live Pack', async () => {
  const store = await fixture();
  const before = await loadPackBundle('p', store);
  state.api.chat = async () => { throw new Error('offline'); };
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  const draft = await loadDraft(store, 'p');
  assert.equal(draft.pack.sources[1].state, 'mapping-failed');
  assert.match(screen.el.textContent, /library\.state\.mapping-failed/);
  assert.deepEqual(await loadPackBundle('p', store), before);
  await button(screen.el, 'library.createReplacement').click();
  assert.match(screen.el.textContent, /library\.additionNotReady/);
  assert.ok(await loadDraft(store, 'p'));
  assert.deepEqual(await loadPackBundle('p', store), before);
});

test('approval reports a conflict and keeps the draft', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  const live = await loadPackBundle('p', store);
  await saveFact({ ...live.facts[0], variants: [{ id: 'new-variant' }] }, { store, sync: null });
  await button(screen.el, 'library.createReplacement').click();
  assert.match(screen.el.textContent, /library\.additionConflict/);
  assert.ok(await loadDraft(store, 'p'));
  assert.equal((await loadPackBundle('p', store)).facts.length, 1);
});

test('discarding an addition draft leaves the live Pack intact', async () => {
  const store = await fixture();
  const before = await loadPackBundle('p', store);
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  const discarded = button(screen.el, 'library.discardAdditions').click();
  const dialog = document.body.children.at(-1);
  button(dialog, 'library.discardAdditions').click();
  await discarded;
  assert.equal(await loadDraft(store, 'p'), null);
  assert.deepEqual(await loadPackBundle('p', store), before);
  assert.ok(button(screen.el, 'library.addMaterial'));
});

test('partial publication locks the draft to retry, even after reload', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  const put = store.put.bind(store);
  let fail = true;
  store.put = async (name, row) => {
    if (fail && name === 'docs' && row.collection === 'facts' && row.id !== 'f') {
      fail = false;
      throw new Error('storage full');
    }
    return put(name, row);
  };
  await button(screen.el, 'library.createReplacement').click();
  assert.equal((await loadReplacement('p', store)).state, 'creating');
  const resumed = review();
  await resumed.mount();
  assert.equal(button(resumed.el, 'library.discardAdditions'), undefined);
  assert.equal(button(resumed.el, 'library.pasteAdd'), undefined);
  assert.ok(button(resumed.el, 'library.retryAdditions'));
  await button(resumed.el, 'library.retryAdditions').click();
  assert.equal(await loadDraft(store, 'p'), null);
  assert.equal((await loadPackBundle('p', store)).facts.length, 1);
  assert.equal((await loadPackBundle(await activePackId(store), store)).facts.length, 2);
});

test('a second paste cannot start while the first source is mapping', async () => {
  const store = await fixture();
  let release;
  let started;
  const mappingStarted = new Promise((resolve) => { started = resolve; });
  const waitForReply = new Promise((resolve) => { release = resolve; });
  const chat = state.api.chat;
  state.api.chat = async (...args) => { started(); await waitForReply; return chat(...args); };
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  const input = nodes(screen.el).find((node) => node.tagName === 'TEXTAREA');
  input.value = 'Plants capture energy from sunlight.';
  const first = button(screen.el, 'library.pasteAdd').click();
  await mappingStarted;
  input.value = 'A second source while mapping is in progress.';
  const second = button(screen.el, 'library.pasteAdd').click();
  release();
  await Promise.all([first, second]);
  assert.equal((await loadDraft(store, 'p')).pack.sources.length, 2);
});

test('double approval starts only one publication', async () => {
  const store = await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  const engine = createSyncEngine({ store, api: {}, isOnline: () => false });
  let packWrites = 0;
  state.sync = { localChange: async (...args) => {
    if (args[0] === 'packs') packWrites++;
    return engine.localChange(...args);
  } };
  const put = store.put.bind(store);
  let release;
  let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let hold = true;
  store.put = async (name, row) => {
    if (hold && name === 'meta' && row.key === 'draft-p') { hold = false; entered(); await gate; }
    return put(name, row);
  };
  const approve = button(screen.el, 'library.createReplacement');
  const first = approve.click();
  await waiting;
  const second = approve.click();
  release();
  await Promise.all([first, second]);
  assert.equal(packWrites, 1);
  assert.equal(await loadDraft(store, 'p'), null);
});

test('a source cannot be removed while it is still mapping', async () => {
  const store = await fixture();
  let release;
  let started;
  const mappingStarted = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const chat = state.api.chat;
  state.api.chat = async (...args) => { started(); await gate; return chat(...args); };
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  nodes(screen.el).find((node) => node.tagName === 'TEXTAREA').value = 'Plants capture energy from sunlight.';
  const mapping = button(screen.el, 'library.pasteAdd').click();
  await mappingStarted;
  const count = document.body.children.length;
  const removing = button(screen.el, 'common.remove').click();
  const openedDialog = document.body.children.length !== count;
  if (openedDialog) button(document.body.children.at(-1), 'common.cancel').click();
  release();
  await Promise.all([mapping, removing]);
  assert.equal(openedDialog, false);
  assert.equal((await loadDraft(store, 'p')).pack.sources[1].state, 'mapped');
});

test('topic edits are unavailable while another source is mapping', async () => {
  await fixture();
  const screen = review();
  await screen.mount();
  await button(screen.el, 'library.addMaterial').click();
  const input = nodes(screen.el).find((node) => node.tagName === 'TEXTAREA');
  input.value = 'Plants capture energy from sunlight.';
  await button(screen.el, 'library.pasteAdd').click();
  assert.ok(button(screen.el, 'review.rename'));
  let release;
  let started;
  const mappingStarted = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const chat = state.api.chat;
  state.api.chat = async (...args) => { started(); await gate; return chat(...args); };
  input.value = 'Plants capture energy from sunlight.';
  const mapping = button(screen.el, 'library.pasteAdd').click();
  await mappingStarted;
  const editable = Boolean(button(screen.el, 'review.rename'));
  release();
  await mapping;
  assert.equal(editable, false);
  assert.ok(button(screen.el, 'review.rename'));
});
