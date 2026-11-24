// Sign in for people who already redeemed their code.

import { state, t } from '../app/state.js';
import { h, mark } from '../app/ui.js';
import { navigate } from '../app/router.js';
import { startSession } from '../app/session.js';

export default function login() {
  const error = h('div', { hidden: true });
  const email = h('input', { id: 'email', class: 'input', type: 'email', autocomplete: 'email', required: true });
  const password = h('input', { id: 'password', class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn p block', type: 'submit' }, t('login.submit'));

  async function onSubmit(e) {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      const payload = await state.api.login(email.value.trim(), password.value);
      await startSession(payload);
      navigate('/', { replace: true });
    } catch (err) {
      error.hidden = false;
      const key = err && err.status === 403 ? 'login.suspended' : err && err.code === 'network' ? 'access.network' : 'login.failed';
      error.replaceChildren(h('div', { class: 'notice bad' }, h('p', {}, t(key))));
    } finally {
      submit.disabled = false;
    }
  }

  const el = h(
    'div',
    { class: 'authwrap' },
    mark(64, 'login'),
    h('div', {}, h('h1', { class: 'h1 disp' }, t('login.title')), h('p', { class: 'tagline' }, t('login.subtitle'))),
    h(
      'form',
      { onsubmit: onSubmit },
      h('div', { class: 'field' }, h('label', { for: 'email' }, t('login.email')), email),
      h('div', { class: 'field' }, h('label', { for: 'password' }, t('login.password')), password),
      error,
      submit,
    ),
    h('p', { class: 'mut small' }, t('login.noAccount')),
    h('a', { class: 'btn g block', href: '#/access' }, t('access.codeLabel')),
  );

  return {
    el,
    title: t('login.title'),
    tabs: false,
    mount() {
      email.focus({ preventScroll: true });
    },
  };
}
