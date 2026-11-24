import { state, t } from '../app/state.js';
import { h } from '../app/ui.js';
import { navigate } from '../app/router.js';
import { newPack } from '../study/library.js';
import { saveDraft } from '../study/store.js';

export default function discover() {
  const root = h('div', { class: 'stack' });
  const topic = h('input', { id: 'discover-topic', class: 'input', maxlength: '300', required: true, autocomplete: 'off' });
  const status = h('p', { class: 'mut', role: 'status', 'aria-live': 'polite' });
  const results = h('div', { class: 'stack' });
  const selected = new Map();
  let searchedTopic = '';
  let queryVersion = 0;
  const proceed = h('button', { type: 'button', class: 'btn p', disabled: true, onclick: continueToReview }, t('discover.continue'));
  const submit = h('button', { type: 'submit', class: 'btn p' }, t('discover.search'));
  topic.addEventListener('input', () => {
    queryVersion++;
    searchedTopic = '';
    selected.clear();
    results.replaceChildren();
    proceed.disabled = true;
    status.textContent = '';
  });

  async function find(event) {
    event.preventDefault();
    const query = topic.value.trim();
    if (!query) { topic.focus(); return; }
    const version = ++queryVersion;
    selected.clear();
    proceed.disabled = true;
    results.replaceChildren();
    status.textContent = t('discover.searching');
    submit.disabled = true;
    try {
      const reply = await state.api.searchTopics(query);
      if (version !== queryVersion) return;
      searchedTopic = query;
      const entries = Array.isArray(reply.results) ? reply.results : [];
      for (const entry of entries) {
        let url;
        try { url = new URL(entry.url); } catch { continue; }
        if (url.protocol !== 'https:' || url.username || url.password || typeof entry.title !== 'string') continue;
        const source = typeof entry.source === 'string' ? entry.source.trim().slice(0, 300) : '';
        const checkbox = h('input', { type: 'checkbox', 'aria-label': entry.title, onchange: (event) => {
          if (event.target.checked) selected.set(url.href, { title: entry.title, url: url.href, source });
          else selected.delete(url.href);
          proceed.disabled = selected.size === 0;
        } });
        results.append(h('div', { class: 'panel stack' },
          h('label', { class: 'row wrap', style: { justifyContent: 'flex-start', gap: '10px' } }, checkbox, h('b', {}, entry.title)),
          source && source !== url.hostname ? h('p', { class: 'mut small' }, source) : null,
          h('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, url.hostname),
          entry.description ? h('p', { class: 'mut small' }, entry.description) : null));
      }
      status.textContent = results.childElementCount ? t('discover.choose') : t('discover.noResults');
    } catch {
      if (version === queryVersion) status.textContent = t('discover.unavailable');
    } finally {
      submit.disabled = false;
    }
  }

  async function continueToReview() {
    if (!selected.size || !searchedTopic) return;
    proceed.disabled = true;
    try {
      const pack = newPack({ title: searchedTopic, lang: state.user?.studyLang || 'en' });
      pack.pendingSources = [...selected.values()];
      await saveDraft({ pack, topics: [], facts: [], edits: { dropped: [], renamed: {}, merged: {} } });
      navigate('/library/review?id=' + encodeURIComponent(pack.id));
    } catch {
      status.textContent = t('discover.saveFailed');
      proceed.disabled = false;
    }
  }

  root.append(h('h1', { class: 'h1' }, t('discover.learn')),
    h('p', { class: 'mut' }, t('discover.online')),
    h('form', { class: 'stack', onsubmit: find }, h('label', { class: 'field stack', for: 'discover-topic' }, t('discover.topic')), topic, submit),
    status, results, proceed,
    h('a', { class: 'btn', href: '#/library' }, t('trail.emptyCta')));
  return { el: root, title: t('discover.learn') };
}
