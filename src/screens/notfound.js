import { t } from '../app/state.js';
import { h } from '../app/ui.js';

export default function notfound() {
  const el = h(
    'div',
    { class: 'stack', style: { textAlign: 'center', paddingTop: '40px' } },
    h('h1', { class: 'h1 disp' }, t('notfound.title')),
    h('p', { class: 'mut' }, t('notfound.body')),
    h('a', { class: 'btn p', href: '#/' }, t('notfound.goTrail')),
  );
  return { el, title: t('notfound.title') };
}
