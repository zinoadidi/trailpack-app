// The Lens bar (design 3.5): a prompt field, an approval sheet for the diff,
// presets, and the rebuild estimate. It never touches facts or progress.
//
// The model call goes through the API client with `task: 'lens'`; when the
// model is unavailable or offline the rule based parser answers instead, and
// the sheet says so.

import { state, t } from '../app/state.js';
import { h, toast } from '../app/ui.js';
import { applyDiff, diffSentence, parseLensDiff, presetLens, regenerationPlan, ruleBasedDiff, LENS_PRESETS, normaliseLens } from '../game/lens.js';
import { saveLens, setActiveLens, loadActiveLens } from '../game/store.js';

const PRESET_NAMES = Object.keys(LENS_PRESETS);

/** Ask the model for a lens diff, falling back to the rules. */
export async function requestLensDiff(prompt, { lens, locale } = {}) {
  const system = 'You turn a study style request into a lens diff. Reply with JSON only: {"fields":{...},"summary":[{"field":"difficulty","from":"medium","to":"hard"}]}. Allowed fields: audience, tone, formats (flash, quiz, oral, task, match, order, swipe, teach, listen; weights 0 to 1), difficulty (easy, medium, hard), length (learn_card_words, flash_back_words), emphasis (list), language, extra. Keep the current Lens when unsure.';
  const user = 'Current lens: ' + JSON.stringify(normaliseLens(lens)) + '\nRequest: ' + String(prompt || '');
  try {
    const reply = await state.api.chat({ task: 'lens', json: true, maxTokens: 600, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ] });
    const parsed = parseLensDiff(reply && reply.text);
    if (Object.keys(parsed.fields).length) return { ...parsed, source: 'model' };
  } catch {
    /* offline, over budget or model down: the rules answer below */
  }
  const fallback = ruleBasedDiff(prompt);
  void locale;
  return { ...fallback, source: 'rules' };
}

/**
 * The bar itself.
 * @param {object} lens the active Lens
 * @param {{ items?: Array<{id, kind, lens_fields?}>, onChange?: Function, reducedMotion?: boolean }} options
 */
export function lensBar(lens, { items = [], onChange = () => {} } = {}) {
  const input = h('input', { class: 'input', type: 'text', 'aria-label': t('lens.promptLabel'), placeholder: t('lens.promptPlaceholder'), maxlength: '300' });
  const status = h('span', { class: 'mut small', 'aria-live': 'polite' });
  const ask = h('button', { class: 'btn p sm', type: 'button' }, t('lens.ask'));
  const presets = h('div', { class: 'row wrap', style: { gap: '6px' } });

  const wrap = h(
    'div',
    { class: 'stack lensbar' },
    h('div', { class: 'row' }, h('b', {}, t('lens.barTitle')), h('span', { class: 'chip k' }, t('lens.current', { title: lens.title }))),
    h('p', { class: 'mut small' }, t('lens.barHelp')),
    h('div', { class: 'row', style: { gap: '8px' } }, input, ask),
    status,
    h('p', { class: 'mut small' }, t('lens.presets')),
    presets,
  );

  async function approve(nextLens, diff, source) {
    const plan = regenerationPlan(items, diff.changed);
    const sheet = h('dialog', { 'aria-labelledby': 'lens-t' });
    const close = () => {
      sheet.close();
      sheet.remove();
    };
    const rows = diff.rows.map((row) => h('div', { class: 'row' }, h('b', { class: 'small' }, t('lens.field.' + row.field)), h('span', { class: 'mut small' }, row.from + ' \u2192 ' + row.to)));
    sheet.append(
      h(
        'div',
        { class: 'sheet stack' },
        h('h2', { id: 'lens-t', class: 'h' }, t('lens.approveTitle')),
        h('p', { class: 'mut small' }, t('lens.approveBody')),
        source === 'rules' ? h('p', { class: 'mut small' }, t('lens.rulesUsed')) : null,
        ...rows,
        h('p', { class: 'small' }, diff.changed.length ? t('lens.regenerateCount', { count: plan.count }) : t('lens.regenerateNone')),
        plan.count ? h('p', { class: 'mut small' }, t('lens.regenerateEstimate', { seconds: Math.max(1, Math.round(plan.estimateMs / 1000)) })) : null,
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: close }, t('lens.discard')),
          h(
            'button',
            {
              class: 'btn p',
              type: 'button',
              onclick: async () => {
                await saveLens(state.store, state.sync, nextLens);
                await setActiveLens(state.store, nextLens.id, { sync: state.sync });
                state.activeLens = nextLens;
                toast(t('lens.regenerated', { count: plan.count }));
                close();
                onChange(nextLens, plan);
              },
            },
            plan.count ? t('lens.regenerate', { count: plan.count }) : t('lens.approve'),
          ),
        ),
      ),
    );
    document.body.append(sheet);
    sheet.showModal();
    sheet.querySelector('.btn.p').focus();
  }

  async function run(prompt) {
    const text = String(prompt || '').trim();
    if (!text) return;
    ask.disabled = true;
    status.textContent = t('lens.thinking');
    try {
      const diff = await requestLensDiff(text, { lens });
      status.textContent = '';
      if (!Object.keys(diff.fields).length) {
        toast(t('lens.noChange'));
        return;
      }
      const applied = applyDiff(lens, diff);
      if (!applied.changed.length) {
        toast(t('lens.noChange'));
        return;
      }
      await approve(applied.lens, applied, diff.source);
    } catch {
      status.textContent = t('lens.failed');
    } finally {
      ask.disabled = false;
    }
  }

  ask.addEventListener('click', () => run(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      run(input.value);
    }
  });

  for (const name of PRESET_NAMES) {
    presets.append(
      h(
        'button',
        {
          class: 'btn sm' + (lens.id === name ? ' g' : ''),
          type: 'button',
          'aria-pressed': String(lens.id === name),
          onclick: async () => {
            const next = presetLens(name, lens);
            const applied = applyDiff(lens, { fields: next });
            if (!applied.changed.length) {
              toast(t('lens.noChange'));
              return;
            }
            await approve({ ...applied.lens, id: name, title: t('lens.preset.' + name) }, applied, 'preset');
          },
        },
        t('lens.preset.' + name),
      ),
    );
  }

  return wrap;
}

/** One line summary for a screen that only has room for the diff. */
export function diffSummary(rows) {
  return diffSentence(rows).join(' \u00B7 ');
}

// ------------------------------------------------------------- active Lens

/**
 * The active Lens for a screen: `{lens, lenses}` with the saved choice first,
 * so every screen that shows a fact agrees on which Lens is in use.
 * Never throws; a broken store gives the default Lens.
 */
export async function lensState(fallback = null) {
  try {
    const found = await loadActiveLens(state.store, { fallback });
    return { lens: found.lens || fallback || normaliseLens(), lenses: found.lenses || [] };
  } catch {
    return { lens: fallback || normaliseLens(), lenses: [] };
  }
}

/** A read only chip naming the active Lens (trail and other fact screens). */
export function lensChip(lens) {
  const title = (lens && lens.title) || t('lens.title');
  return h('span', { class: 'chip k', title: t('lens.current', { title }) }, t('lens.chip', { title }));
}

/**
 * Every saved Lens plus the default one, as a segmented picker. Choosing a row
 * saves the choice (device and account) and calls `onChange(lens)`.
 */
export function lensPicker(lenses, active, { onChange = () => {}, label = '' } = {}) {
  const list = (lenses || []).length ? lenses : [normaliseLens()];
  const activeId = (active && active.id) || list[0].id;
  const wrap = h('div', { class: 'seg wrap', role: 'group', 'aria-label': label || t('lens.pickerLabel') });
  for (const lens of list) {
    wrap.append(
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(lens.id === activeId),
          onclick: async () => {
            const chosen = normaliseLens(lens);
            await setActiveLens(state.store, chosen.id, { sync: state.sync });
            state.activeLens = chosen;
            toast(t('lens.nowUsing', { title: chosen.title }));
            onChange(chosen);
          },
        },
        lens.title || lens.id,
      ),
    );
  }
  return wrap;
}

