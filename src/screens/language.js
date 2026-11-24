// Language settings: app language and study language are separate.

import { state, t, setLanguage } from '../app/state.js';
import { h } from '../app/ui.js';
import { setPref } from '../app/prefs.js';
import { LANGS } from '../i18n/format.js';
import { patchMe } from '../app/session.js';
import { navigate } from '../app/router.js';

function picker(label, current, onPick) {
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'small mut', style: { fontWeight: '600' } }, label),
    h(
      'div',
      { class: 'langlist', role: 'group', 'aria-label': label },
      ...LANGS.map((lang) => {
        const sel = current === lang;
        return h(
          'button',
          {
            class: 'lang' + (sel ? ' sel' : ''),
            type: 'button',
            'aria-pressed': String(sel),
            onclick: () => onPick(lang),
          },
          h('span', { class: 'c2' }, lang.toUpperCase()),
          h('b', {}, t('languages.' + lang)),
          sel ? h('span', { class: 'chip m', 'aria-hidden': 'true' }, '✓') : null,
        );
      }),
    ),
  );
}

export default function language() {
  const user = state.user;
  const appLang = user ? user.lang : state.lang;
  const studyLang = user ? user.studyLang : state.lang;

  async function pickApp(lang) {
    setPref('lang', lang);
    await setLanguage(lang);
    if (user) {
      try {
        await patchMe({ lang });
      } catch {
        /* keep the device choice */
      }
    }
    navigate('/language', { replace: true });
  }

  async function pickStudy(lang) {
    if (!user) return;
    await patchMe({ studyLang: lang });
    navigate('/language', { replace: true });
  }

  const el = h(
    'div',
    { class: 'stack' },
    h('div', { class: 'row' }, h('a', { class: 'btn sm', href: '#/me', 'aria-label': t('common.back') }, '←'), h('h1', { class: 'h1' }, t('me.languageTitle'))),
    picker(t('me.appLanguage'), appLang, pickApp),
    user ? picker(t('me.studyLanguage'), studyLang, pickStudy) : null,
    user ? h('p', { class: 'hint' }, t('me.studyLanguageHelp')) : null,
    h('p', { class: 'mut small' }, 'Draft translations are marked needs review. English is complete.'),
  );

  return { el, title: t('me.languageTitle') };
}
