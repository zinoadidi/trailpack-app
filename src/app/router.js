// Hash router. Routes are plain functions returning { el, title, tabs, mount }.
// A route change clears the main element, sets the document title and moves
// focus to the heading so keyboard and screen reader users land in place.

import { state, subscribe } from './state.js';
import { t } from './state.js';
import { clear } from './ui.js';

const routes = new Map();
const guards = [];
let current = null;
let container = null;

export function register(path, loader) {
  routes.set(path, loader);
}

/** Guard called before each route: (route, ctx) => forced path or null. */
export function guard(fn) {
  guards.push(fn);
}

export function match(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const [path] = raw.split('?');
  const clean = path.replace(/\/+$/, '') || '/';
  const exact = routes.get(clean);
  if (exact) return { path: clean, loader: exact };
  const segments = clean.split('/').filter(Boolean);
  if (segments.length === 2 && routes.get(segments[0] + '/*')) {
    return { path: segments[0] + '/*', loader: routes.get(segments[0] + '/*'), param: decodeURIComponent(segments[1]) };
  }
  return null;
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (replace) location.replace(target);
  else location.hash = target;
}

export async function render(force = false) {
  if (!container) return;
  const hash = location.hash || '#/';
  if (!force && current && current.hash === hash && current.route) {
    current.view?.refresh?.();
    return;
  }
  const mm = match(hash);
  const loggedIn = Boolean(state.user);
  for (const g of guards) {
    const forced = g({ mm, loggedIn });
    if (forced) {
      navigate(forced, { replace: true });
      return;
    }
  }
  const route = mm ? await mm.loader(mm) : await routes.get('/*')(mm);
  if (!route) return;
  if (current && current.route && current.route.destroy) current.route.destroy();
  clear(container);
  container.className = 'main' + (route.tabs === false ? ' no-tabs' : '');
  container.append(route.el);
  container.scrollTop = 0;
  window.scrollTo(0, 0);
  document.title = route.title ? `${route.title} · ${t('app.name')}` : t('app.name');
  current = { hash, route, view: route };
  if (route.mount) await route.mount();
  const heading = route.el.querySelector('h1, h2');
  if (heading) {
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  } else {
    container.focus({ preventScroll: true });
  }
  document.dispatchEvent(new CustomEvent('tp:navigated', { detail: { hash } }));
}

export function startRouter(el) {
  container = el;
  window.addEventListener('hashchange', () => render());
  subscribe((type) => {
    if (type === 'language') render(true);
  });
  return render(true);
}

export function currentPath() {
  return (location.hash || '#/').replace(/^#/, '') || '/';
}
