// Access screen: the only screen before sign in. One field, one button, and
// the same message for every failure, as the contract requires.

import { state, t } from '../app/state.js';
import { h, mark, focusables } from '../app/ui.js';
import { navigate } from '../app/router.js';
import { setPref } from '../app/prefs.js';
import { LANGS } from '../i18n/format.js';

const CODE_RE = /^TRL-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

export function normaliseCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const body = raw.startsWith('TRL') ? raw.slice(3) : raw;
  if (body.length !== 12) return String(input || '').trim().toUpperCase();
  return `TRL-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

export function isValidCode(code) {
  return CODE_RE.test(normaliseCode(code));
}

export default function access() {
  const error = h('div', { class: 'stack', role: 'alert', hidden: true });
  const input = h('input', {
    id: 'code',
    class: 'input mono',
    name: 'code',
    autocomplete: 'one-time-code',
    autocapitalize: 'characters',
    spellcheck: 'false',
    inputmode: 'text',
    placeholder: t('access.codePlaceholder'),
    'aria-describedby': 'code-hint',
    required: true,
  });
  const submit = h('button', { class: 'btn p block', type: 'submit' }, t('access.continue'));
  const hint = h('p', { class: 'hint', id: 'code-hint' }, t('access.codeFormat'));

  function showError(key) {
    error.hidden = false;
    error.replaceChildren(h('div', { class: 'notice bad' }, h('p', {}, t(key))));
  }

  function showNetwork() {
    error.hidden = false;
    error.replaceChildren(h('div', { class: 'notice warn' }, h('p', {}, t('access.network'))));
  }

  async function onSubmit(e) {
    e.preventDefault();
    error.hidden = true;
    const code = normaliseCode(input.value);
    if (!isValidCode(code)) {
      showError('access.invalid');
      input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = t('access.checking');
    try {
      await state.api.checkCode(code);
      sessionStorage.setItem('trailpack.redeemCode', code);
      navigate('/create');
    } catch (err) {
      if (err && (err.status === 429 || err.code === 'too_many')) showError('access.tooMany');
      else if (err && err.code === 'network') showNetwork();
      else showError('access.invalid');
    } finally {
      submit.disabled = false;
      submit.textContent = t('access.continue');
    }
  }

  function langButton(lang) {
    const selected = state.lang === lang;
    return h(
      'button',
      {
        class: 'lang' + (selected ? ' sel' : ''),
        type: 'button',
        'aria-pressed': String(selected),
        onclick: async () => {
          setPref('lang', lang);
          const { setLanguage } = await import('../app/state.js');
          await setLanguage(lang);
          if (state.user) {
            try {
              await state.api.updateMe({ lang });
            } catch {
              /* offline: device preference still applies */
            }
          }
        },
      },
      h('span', { class: 'c2' }, lang.toUpperCase()),
      h('b', {}, t('languages.' + lang)),
      selected ? h('span', { class: 'chip m', 'aria-hidden': 'true' }, '✓') : null,
    );
  }

  const el = h(
    'div',
    { class: 'authwrap' },
    mark(84, 'access'),
    h('div', {}, h('h1', { class: 'h1 disp' }, t('access.title')), h('p', { class: 'tagline' }, t('app.tagline'))),
    h('div', { class: 'card center' }, h('p', { class: 'sub' }, t('access.invite'))),
    h(
      'form',
      { onsubmit: onSubmit, novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'code' }, t('access.codeLabel')), input, hint),
      error,
      submit,
    ),
    h('a', { class: 'btn g block', href: '#/login' }, t('access.haveAccount')),
    h(
      'button',
      {
        class: 'btn sm',
        type: 'button',
        'aria-expanded': 'false',
        onclick: (e) => {
          const panel = el.querySelector('.langpanel');
          const open = panel.hidden;
          panel.hidden = !open;
          e.currentTarget.setAttribute('aria-expanded', String(open));
          if (open) focusables(panel)[0]?.focus();
        },
      },
      t('access.languageBeforeSignIn'),
    ),
    h(
      'div',
      { class: 'langpanel langlist', hidden: true },
      h('p', { class: 'hint', id: 'langlabel' }, t('a11y.languageGroup')),
      ...LANGS.map(langButton),
    ),
    h('p', { class: 'mut small' }, t('access.lost')),
  );

  return {
    el,
    title: t('access.codeLabel'),
    tabs: false,
    mount() {
      input.focus({ preventScroll: true });
    },
  };
}

void focusables;
