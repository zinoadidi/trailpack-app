// Tiny DOM helpers. Every string goes through t(), every inserted value is
// text, never HTML, so catalogue or server content cannot inject markup.

/** Create an element. `props` sets attributes; `children` may be nodes or strings. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value; // only for our own static markup
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

const ICONS = {
  trail: 'M4 19h9l-4-5h8l-4-5h5',
  trailDot: true,
  cards: 'M3 6h14v12H3z M8 3h11a2 2 0 0 1 2 2v10',
  mic: 'M9 3h6v11a3 3 0 0 1-6 0z M5 11a7 7 0 0 0 14 0 M12 18v3',
  lib: 'M5 4h4v16H5z M11 4h4v16h-4z M17.5 5l3 .8-3.5 14-3-.8z',
  me: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 20c1-4 4-6 8-6s7 2 8 6',
  flame: null,
  back: 'M15 5l-7 7 7 7',
};

/** Inline SVG line icon, 2px stroke, currentColor. */
export function icon(name, size = 22) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (name === 'flame') {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4 0-7 1-10z');
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || ICONS.me);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  if (ICONS[name] && ICONS[name].includes('M12 4') && name === 'trail') {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', '19');
    dot.setAttribute('cy', '5');
    dot.setAttribute('r', '2');
    dot.setAttribute('fill', 'currentColor');
    svg.append(dot);
  }
  return svg;
}

/** The switchback mark, inline so it needs no network. */
export function mark(size = 40, id = 'm') {
  const gid = 'g-' + id + '-' + Math.random().toString(36).slice(2, 7);
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="Trailpack"><defs><linearGradient id="${gid}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#C6F432"/><stop offset="1" stop-color="#B86BFF"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="16" fill="#150C2E"/><path d="M12 47 H34 L26 37 H46 L38 28 H50 V22" fill="none" stroke="url(#${gid})" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="15" r="6" fill="#FFC93C"/></svg>`;
  return wrap.firstElementChild;
}

export function focusables(root) {
  return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
}

/** Announce to screen readers without moving focus. */
export function announce(message) {
  const region = document.getElementById('live');
  if (region) region.textContent = '';
  let live = document.getElementById('live');
  if (!live) {
    live = h('div', { id: 'live', 'aria-live': 'polite', 'aria-atomic': 'true', class: 'sr-only' });
    document.body.append(live);
  }
  live.textContent = message;
  void region;
}

export function toast(message) {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

export function bytesLabel(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'kB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** Simple confirm dialog returning a promise. Text is passed in already translated. */
export function confirmDialog({ title, body, confirm, cancel }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-labelledby': 'dlg-t' });
    const close = (value) => {
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    dlg.append(
      h(
        'div',
        { class: 'sheet' },
        h('h2', { id: 'dlg-t', class: 'h' }, title),
        body ? h('p', { class: 'mut' }, body) : null,
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, cancel),
          h('button', { class: 'btn p', type: 'button', onclick: () => close(true) }, confirm),
        ),
      ),
    );
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(false);
    });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('.btn.p').focus();
  });
}
