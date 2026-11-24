// The review screen (#/library/review?id=...): ingesting documents, the topic
// map, edits, freeze and variants.
//
// Split in two files so each stays readable:
//   this file        the screen, the add panel (drop, pick, paste), the run
//   review-edit.js   the topic map editor (counts, rename, merge, drop)

import { state, t } from '../app/state.js';
import { h, toast, announce, confirmDialog } from '../app/ui.js';
import { navigate } from '../app/router.js';
import { newPack, newSource, sourceId, setSourceState, removeSource, chunksForSource, wordsOf, applyMapReply, foldTopics, canFreeze, freezePack, factsNeedingVariants, variantsFromReply, variantsProgress, isAccepted, rejectReason, extensions, acceptAttribute } from '../study/library.js';
import { parseJsonReply } from '../study/prompts.js';
import { normaliseVariants, safeId, reviewQueue } from '../study/pack.js';
import { makeIngest } from '../study/ingest.js';
import { loadPack, savePack, loadTopics, loadFacts, saveTopic, saveFact, loadDraft, saveDraft, clearDraft, setActivePack, deletePackDocs, deleteFactDocs, publishReplacementDraft, loadReplacement } from '../study/store.js';
import { renderReplacementOffers } from './replacement-offer.js';
import { beginAdditionDraft } from '../study/additions.js';
import { topicEditor } from './review-edit.js';

export default function review(mm) {
  let packId = new URLSearchParams((location.hash || '').split('?')[1] || '').get('id');
  const root = h('div', { class: 'stack' });
  const head = h('div', { class: 'stack' });
  const offers = h('div', { class: 'stack' });
  const body = h('div', { class: 'stack' });
  const status = h('p', { class: 'mut small', 'aria-live': 'polite' });
  const fileInput = h('input', { type: 'file', multiple: true, accept: acceptAttribute(), style: { display: 'none' } });
  const pasteBox = h('textarea', { class: 'input', rows: '6', placeholder: t('library.pastePlaceholder'), 'aria-label': t('library.pasteLabel'), maxlength: '400000' });
  let pack = null;
  let topics = [];
  let facts = [];
  let edits = { dropped: [], renamed: {}, merged: {} };
  let additionBase = null;
  let replacementJournal = null;
  let saveFailed = false;
  let running = false;

  const ingest = () => makeIngest({ api: state.api, files: state.files });

  function say(text) {
    if (!text && saveFailed) return;
    status.textContent = text || '';
    if (text) announce(text);
  }

  // ------------------------------------------------------- load and save

  async function persist({ draftToo = false } = {}) {
    if (additionBase) {
      try {
        await saveDraft({ pack, topics, facts, edits, additionBase });
        saveFailed = false;
        return true;
      } catch {
        saveFailed = true;
        say(t('library.additionSaveFailed'));
        return false;
      }
    }
    pack = await savePack(pack);
    if (draftToo) await saveDraft({ pack, topics, facts, edits }).catch(() => null);
    return true;
  }

  async function load() {
    if (!packId) {
      const fresh = newPack({ title: t('library.untitled'), lang: state.user?.studyLang || 'en' });
      navigate('/library/review?id=' + encodeURIComponent(fresh.id), { replace: true });
      return false;
    }
    const draft = await loadDraft(state.store, packId);
    replacementJournal = await loadReplacement(packId, state.store);
    if (draft && draft.pack) {
      pack = draft.pack;
      topics = draft.topics || [];
      facts = draft.facts || [];
      edits = draft.edits || edits;
      additionBase = draft.additionBase || null;
      return true;
    }
    pack = await loadPack(state.store, packId);
    if (!pack) {
      body.replaceChildren(h('div', { class: 'panel stack' }, h('p', { class: 'mut' }, t('library.notFound')), h('a', { class: 'btn', href: '#/library' }, t('library.backToLibrary'))));
      return false;
    }
    topics = await loadTopics(state.store, packId);
    facts = await loadFacts(state.store, packId);
    if (pack.status === 'frozen') edits = { dropped: [], renamed: {}, merged: {} };
    return true;
  }

  async function beginAdding() {
    if (running || pack.status !== 'frozen' || replacementJournal?.choice === 'pending') return;
    const draft = beginAdditionDraft({ pack, topics, facts });
    try {
      await saveDraft(draft);
      ({ pack, topics, facts, edits, additionBase } = draft);
      saveFailed = false;
      say('');
      render();
    } catch {
      saveFailed = true;
      say(t('library.additionSaveFailed'));
    }
  }

  async function discardAdditions() {
    if (running || !additionBase || additionBase.publicationStarted || replacementJournal?.state === 'creating') return;
    const ok = await confirmDialog({ title: t('library.discardAdditions'), body: t('library.discardAdditionsHelp'), confirm: t('library.discardAdditions'), cancel: t('common.cancel') });
    if (!ok) return;
    try {
      await clearDraft(pack.id);
      additionBase = null;
      saveFailed = false;
      pack = await loadPack(state.store, pack.id);
      topics = await loadTopics(state.store, pack.id);
      facts = await loadFacts(state.store, pack.id);
      edits = { dropped: [], renamed: {}, merged: {} };
      say('');
      render();
    } catch {
      saveFailed = true;
      say(t('library.additionSaveFailed'));
    }
  }

  // ---------------------------------------------------------------- run

  /**
   * Read one source: extract, chunk, map. Failures are recorded on the source
   * so one bad file does not stop the rest.
   */
  async function readSource(source, bytes, suppliedExtraction = null) {
    say(t('library.reading', { name: source.name }));
    let extraction;
    try {
      extraction = suppliedExtraction || await ingest().extract(source, bytes);
    } catch (err) {
      pack.sources = (pack.sources || []).map((s) => (s.id === source.id ? { ...s, state: 'reading-failed', error: err.code || 'error' } : s));
      await persist({ draftToo: true });
      return false;
    }
    const words = wordsOf(extraction);
    pack.sources = (pack.sources || []).map((s) => (s.id === source.id ? { ...s, state: 'mapping', words, pages: (extraction.pages || []).length || 1 } : s));
    if (!(await persist({ draftToo: true }))) return false;
    const chunks = chunksForSource(source, extraction, undefined, { preservePages: Boolean(suppliedExtraction) });
    say(t('library.mapping', { name: source.name, count: chunks.length }));
    const state0 = { topics, facts, warnings: [] };
    let next = state0;
    try {
      for (const [index, batch] of chunks.reduce((rows, chunk) => {
        const last = rows[rows.length - 1];
        if (last && last.length < 3) last.push(chunk);
        else rows.push([chunk]);
        return rows;
      }, []).entries()) {
        say(t('library.mappingProgress', { name: source.name, done: index + 1, total: Math.ceil(chunks.length / 3) }));
        const reply = await ingest().map(batch, { title: pack.title, goal: pack.goal, lang: pack.lang });
        for (const part of [reply, ...(reply.more || [])]) {
          const parsed = parseJsonReply(part.text);
          if (parsed) next = applyMapReply(next, parsed, { packId: pack.id, chunks });
        }
      }
    } catch (err) {
      pack.sources = (pack.sources || []).map((s) => (s.id === source.id ? { ...s, state: 'mapping-failed', error: err.code || 'error' } : s));
      await persist({ draftToo: true });
      return false;
    }
    const folded = foldTopics(next.topics, next.facts);
    topics = folded.topics;
    facts = folded.facts;
    pack.sources = (pack.sources || []).map((s) => (s.id === source.id ? { ...s, state: 'mapped' } : s));
    return persist({ draftToo: true });
  }

  async function addFiles(fileList) {
    if (running) return;
    running = true;
    try {
      for (const file of fileList) {
        const reason = rejectReason(file.name, file.type);
        if (reason) {
          toast(t(reason, { name: file.name }));
          continue;
        }
        const id = sourceId(file.name);
        const source = newSource({ id, name: file.name, type: file.type || 'application/octet-stream', size: file.size, fileId: id });
        const previousSources = pack.sources;
        pack.sources = [...(pack.sources || []), source];
        if (!(await persist({ draftToo: true }))) { pack.sources = previousSources; return; }
        render();
        const bytes = new Uint8Array(await file.arrayBuffer());
        await readSource(source, bytes);
        render();
      }
    } finally {
      running = false;
      say('');
      render();
    }
  }

  async function addPaste() {
    if (running) return;
    const text = pasteBox.value.trim();
    if (!text) return;
    running = true;
    try {
      const name = (pack.sources || []).length ? t('library.pastedName', { n: (pack.sources || []).length + 1 }) : t('library.pastedName', { n: 1 });
      const id = sourceId(name);
      const source = newSource({ id, name, type: 'text/plain', size: text.length, fileId: null });
      const previousSources = pack.sources;
      pack.sources = [...(pack.sources || []), source];
      if (!(await persist({ draftToo: true }))) { pack.sources = previousSources; return; }
      pasteBox.value = '';
      render();
      await readSource(source, new TextEncoder().encode(text));
    } finally {
      running = false;
      say('');
    }
    render();
  }

  async function importSource(item) {
    if (running) return;
    running = true;
    render();
    try {
      const reply = await state.api.fetchSource(item.url);
      if (typeof reply.text !== 'string' || !reply.text.trim()) throw new Error('empty_source');
      const name = item.title.slice(0, 150);
      const id = sourceId(name);
      const source = { ...newSource({ id, name, type: 'text/plain', size: new TextEncoder().encode(reply.text).length, fileId: null }), url: reply.url };
      pack.sources = [...(pack.sources || []), source];
      if (!(await persist({ draftToo: true }))) return;
      if (!(await readSource(source, null, reply))) {
        pack.sources = (pack.sources || []).filter((entry) => entry.id !== id);
        throw new Error('source_mapping_failed');
      }
      pack.pendingSources = (pack.pendingSources || []).filter((entry) => entry.url !== item.url);
      await persist({ draftToo: true });
    } catch {
      pack.pendingSources = (pack.pendingSources || []).map((entry) => entry.url === item.url ? { ...entry, failed: true } : entry);
      if (additionBase) await persist({ draftToo: true });
      else await saveDraft({ pack, topics, facts, edits }).catch(() => null);
    } finally {
      running = false;
      say('');
      render();
    }
  }

  function pendingSources() {
    const entries = pack.pendingSources || [];
    if (!entries.length) return null;
    return h('section', { class: 'panel stack' }, h('h2', { class: 'h' }, t('discover.selected')),
      ...entries.map((entry) => h('div', { class: 'stack' },
        h('b', {}, entry.title),
        entry.failed ? h('p', { class: 'notice warn', role: 'status' }, t('discover.importFailed')) : null,
        h('div', { class: 'row wrap', style: { gap: '8px', justifyContent: 'flex-start' } },
          h('button', { class: 'btn p sm', type: 'button', disabled: running, onclick: () => importSource(entry) }, t('discover.importSource', { title: entry.title })),
          h('button', { class: 'btn sm', type: 'button', disabled: running, onclick: async () => {
            pack.pendingSources = pack.pendingSources.filter((item) => item.url !== entry.url);
            if (additionBase) await persist({ draftToo: true });
            else await saveDraft({ pack, topics, facts, edits });
            render();
          } }, t('discover.removeSource', { title: entry.title }))))));
  }

  async function removeOne(source) {
    if (running) return;
    const ok = await confirmDialog({ title: t('library.removeSource'), body: source.name, confirm: t('common.remove'), cancel: t('common.cancel') });
    if (!ok) return;
    pack = removeSource(pack, source.id);
    await persist({ draftToo: true });
    render();
  }

  // --------------------------------------------------------------- steps

  async function freeze() {
    if (running) return;
    const check = canFreeze(pack, topics, facts);
    if (!check.ok) {
      toast(t(check.problems[0]));
      return;
    }
    if (additionBase) {
      const originalSources = new Set(additionBase.sources.map((source) => source.id));
      if ((pack.sources || []).some((source) => !originalSources.has(source.id) && source.state !== 'mapped')) {
        say(t('library.additionNotReady'));
        return;
      }
      running = true;
      let result;
      try {
        if (!(await persist({ draftToo: true }))) return;
        result = await publishReplacementDraft({ pack, topics, facts, edits, additionBase });
      } finally {
        running = false;
      }
      if (!result.ok) {
        replacementJournal = await loadReplacement(pack.id, state.store);
        if (additionBase.publicationStarted || replacementJournal?.state === 'creating') render();
        say(t(result.reason === 'conflict' ? 'library.additionConflict' : 'library.additionPublishFailed'));
        return;
      }
      additionBase = null;
      pack = await loadPack(state.store, result.packId);
      packId = result.packId;
      replacementJournal = await loadReplacement(packId, state.store);
      topics = await loadTopics(state.store, pack.id);
      facts = await loadFacts(state.store, pack.id);
      edits = { dropped: [], renamed: {}, merged: {} };
      toast(t('library.frozen'));
      say(t('library.frozen'));
      render();
      await renderReplacementOffers(offers, { packId, onChange: async () => { replacementJournal = await loadReplacement(packId, state.store); render(); } });
      navigate('/library/review?id=' + encodeURIComponent(packId));
      return;
    }
    const frozen = freezePack(pack, topics, facts, { model: state.user?.model || 'auto' });
    pack = frozen.pack;
    topics = frozen.topics;
    facts = frozen.facts;
    await persist();
    await clearDraft(pack.id);
    for (const topic of topics) await saveTopic(topic);
    for (const fact of facts) await saveFact(fact);
    toast(t('library.frozen'));
    say(t('library.frozen'));
    render();
  }

  async function generateVariants() {
    if (running) return;
    running = true;
    try {
      const batches = factsNeedingVariants(facts, 5);
      for (const [index, batch] of batches.entries()) {
        say(t('library.variantsProgress', { done: index + 1, total: batches.length }));
        try {
          const reply = await ingest().generate(batch, { lang: pack.lang });
          const rows = variantsFromReply(parseJsonReply(reply.text), reply.factIds);
          for (const row of rows) {
            const fact = facts.find((f) => f.id === row.factId);
            if (!fact) continue;
            const added = normaliseVariants(row.variants, { factId: fact.id, existing: fact.variants || [] });
            fact.variants = [...(fact.variants || []), ...added];
          }
          // `batch` holds the same objects as `facts`, so save those references
          // and the screen's counts (which read `facts`) move as one.
          for (const fact of batch) {
            await saveFact(fact);
          }
        } catch (err) {
          toast(t('library.variantFailed') + ' · ' + (err.code || 'error'));
        }
      }
      const progress = variantsProgress(facts);
      say(progress.complete ? t('library.variantsDone', { count: progress.total }) : t('library.variantsPartial', { done: progress.done, total: progress.total }));
      pack = await savePack(pack);
      render();
      toast(t(progress.complete ? 'flow.questionsWritten' : 'flow.questionsPartial', progress.complete ? { count: progress.total } : { done: progress.done, total: progress.total }));
    } finally {
      running = false;
    }
  }

  function render() {
    if (!pack) return;
    if (additionBase && (additionBase.publicationStarted || replacementJournal?.state === 'creating')) {
      head.replaceChildren(h('h1', { class: 'h1' }, pack.title || t('library.untitled')));
      body.replaceChildren(h('div', { class: 'panel stack' },
        h('p', {}, t('library.replacementRetryHelp')),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn p', type: 'button', onclick: freeze }, t('library.retryAdditions')),
          h('a', { class: 'btn', href: '#/' }, t('review.startTrail')))));
      return;
    }
    const draft = pack.status !== 'frozen';
    const needsReview = reviewQueue(facts, topics).count;
    head.replaceChildren(
      h(
        'div',
        { class: 'row' },
        h('div', {}, h('div', { class: 'mut small' }, t('nav.library')), h('h1', { class: 'h1' }, pack.title || t('library.untitled'))),
        h('span', { class: 'chip ' + (draft ? 'a' : 'm') }, draft ? t('library.statusDraft') : t('library.statusFrozen')),
        needsReview ? h('span', { class: 'chip a' }, t('flow.needsReviewCount', { count: needsReview })) : null,
      ),
      draft
        ? h(
            'div',
            { class: 'stack' },
            h('p', { class: 'mut small' }, t(additionBase ? 'library.replacementDraftHelp' : 'library.reviewHelp')),
            additionBase ? h('button', { class: 'btn sm', type: 'button', onclick: discardAdditions }, t('library.discardAdditions')) : null,
            pendingSources(),
            h(
              'div',
              {
                class: 'panel stack',
                ondragover: (e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add('drop');
                },
                ondragleave: (e) => e.currentTarget.classList.remove('drop'),
                ondrop: (e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('drop');
                  addFiles([...e.dataTransfer.files]);
                },
              },
              h('div', { class: 'row wrap' }, h('b', {}, t('library.addTitle')), h('span', { class: 'mut small' }, t('library.dropHelp', { types: extensions }))),
              h('div', { class: 'row wrap', style: { gap: '8px' } }, h('button', { class: 'btn p sm', type: 'button', onclick: () => fileInput.click() }, t('library.pickFiles')), h('button', { class: 'btn sm', type: 'button', onclick: () => pasteBox.focus() }, t('library.pasteTab'))),
              pasteBox,
              h('div', { class: 'row' }, h('span', { class: 'mut small' }, t('library.pasteCounter')), h('button', { class: 'btn sm g', type: 'button', onclick: addPaste }, t('library.pasteAdd'))),
            ),
            sourceList(),
            (pack.sources || []).length ? h('div', { class: 'row' }, h('span', { class: 'mut small' }, t('library.stepHint')), h('button', { class: 'btn p sm', type: 'button', onclick: () => navigate('/library/review?id=' + encodeURIComponent(pack.id) + '&edit=1') }, t('library.openReview'))) : null,
          )
        : h('div', { class: 'stack' }, h('p', { class: 'mut' }, t('library.frozenHelp')), replacementJournal?.choice === 'pending' && pack.id === packId ? null : h('button', { class: 'btn p sm', type: 'button', onclick: beginAdding }, t('library.addMaterial'))),
    );
    body.replaceChildren(topicEditor({
      pack,
      topics,
      facts,
      edits,
      frozen: !draft,
      additionMode: Boolean(additionBase),
      busy: Boolean(additionBase) && running,
      protectedTopicIds: additionBase?.topics.map((topic) => topic.id) || [],
      onChange: async (next) => {
        if (additionBase && running) return;
        const removed = facts.filter((fact) => !next.facts.some((kept) => kept.id === fact.id));
        if (!additionBase) for (const fact of removed) await deleteFactDocs([fact.id], { allFacts: next.facts });
        edits = next.edits;
        topics = next.topics;
        facts = next.facts;
        await persist({ draftToo: true });
        render();
      },
      onFreeze: freeze,
      onGenerate: generateVariants,
      onRenamePack: async (title) => {
        pack = { ...pack, title };
        await persist({ draftToo: true });
        render();
      },
      onMakeActive: async () => {
        await setActivePack(pack.id);
        toast(t('library.isActive'));
        render();
      },
      onDelete: async () => {
        const ok = await confirmDialog({ title: t('library.deletePack'), body: pack.title, confirm: t('common.remove'), cancel: t('common.cancel') });
        if (!ok) return;
        await deletePackDocs(pack.id);
        await clearDraft(pack.id);
        navigate('/library');
      },
    }));
  }

  function sourceList() {
    const sources = pack.sources || [];
    if (!sources.length) return h('p', { class: 'mut small' }, t('library.noSources'));
    return h(
      'div',
      { class: 'stack' },
      ...sources.map((source) =>
        h(
          'div',
          { class: 'panel row' },
          h('div', { class: 'stack', style: { gap: '2px' } }, h('b', { class: 'small' }, source.name), h('span', { class: 'mut small' }, t('library.sourceLine', { words: source.words || 0, pages: source.pages || 1 })),
            source.url && /^https:\/\//i.test(source.url) ? h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, new URL(source.url).hostname) : null),
          h(
            'div',
            { class: 'row', style: { gap: '6px' } },
            h('span', { class: 'chip ' + (source.state === 'mapped' ? 'm' : source.state.includes('failed') ? 'e' : 'k') }, t('library.state.' + source.state)),
            pack.status === 'draft' && !additionBase?.sources.some((original) => original.id === source.id) ? h('button', { class: 'btn sm danger', type: 'button', disabled: running, 'aria-label': t('library.removeSource') + ': ' + source.name, onclick: () => removeOne(source) }, t('common.remove')) : null,
          ),
        ),
      ),
    );
  }

  root.append(head, offers, status, fileInput, body);
  fileInput.addEventListener('change', () => {
    addFiles([...fileInput.files]).finally(() => {
      fileInput.value = '';
    });
  });

  return {
    el: root,
    title: t('nav.library'),
    async mount() {
      const ok = await load();
      if (ok) render();
      await renderReplacementOffers(offers, { packId, onChange: async () => { replacementJournal = await loadReplacement(packId, state.store); render(); } });
    },
  };
}

void isAccepted;
void safeId;
