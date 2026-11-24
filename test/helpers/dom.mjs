// A DOM small enough for the screens: elements, attributes, events and text.
// Just what src/app/ui.js and the screens touch, so a screen can be rendered
// and clicked in node without a browser. Not a general DOM.

/** `[name]`, `[name=value]`, `[name~=value]` and `[name*=value]` on one node. */
function attributeMatch(node, selector) {
  const body = selector.slice(1, -1);
  const match = body.match(/^([\w-]+)\s*([~*^$|]?=)?\s*(.*)$/);
  if (!match) return false;
  const [, name, op, raw] = match;
  const value = (raw || '').replace(/^["']|["']$/g, '');
  const actual = node.attributes[name];
  if (actual === undefined) return false;
  if (op === '=') return actual === value;
  if (op === '~=') return actual.split(/\s+/).includes(value);
  if (op === '*=') return actual.includes(value);
  if (op === '^=') return actual.startsWith(value);
  if (op === '$=') return actual.endsWith(value);
  if (op === '|=') return actual === value || actual.startsWith(value + '-');
  return true;
}

class Node {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    // dataset writes through to the data-* attributes, as in a browser, so
    // selectors such as button[data-practice-type] find the node.
    this.dataset = new Proxy({}, {
      set: (target, key, value) => {
        target[key] = String(value);
        this.attributes['data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())] = String(value);
        return true;
      },
      deleteProperty: (target, key) => {
        delete target[key];
        delete this.attributes['data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())];
        return true;
      },
    });
    this.style = {};
    this.listeners = new Map();
    this._text = '';
  }

  get firstChild() { return this.children[0] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.documentElement; }
  get className() { return this.attributes.class || ''; }
  set className(value) { this.attributes.class = value; }

  append(...nodes) {
    for (const node of nodes.flat(Infinity)) {
      const child = node instanceof Node ? node : this.ownerDocument.createTextNode(String(node));
      if (child.parentNode) child.parentNode.children = child.parentNode.children.filter((c) => c !== child);
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }

  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return name in this.attributes; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  focus() { this.ownerDocument.activeElement = this; }
  select() {}
  click() { this.dispatch('click', { target: this }); }
  dispatch(type, event = {}) {
    // A browser event bubbles unless a handler stops it; the handlers see the
    // same event object, so stopPropagation() and preventDefault() work.
    const shared = {
      target: event.target || this,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { shared.defaultPrevented = true; },
      stopPropagation() { shared.propagationStopped = true; },
      ...event,
    };
    let node = this;
    while (node && !shared.propagationStopped) {
      for (const fn of [...(node.listeners.get(type) || [])]) {
        if (shared.propagationStopped) break;
        fn({ ...shared, currentTarget: node });
      }
      node = node.parentNode;
    }
    return shared;
  }

  get hidden() { return this.attributes.hidden === '' || this.attributes.hidden === true; }
  set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get value() { return this._value === undefined ? '' : this._value; }
  set value(value) { this._value = String(value); }
  get textContent() {
    if (this.tagName === '#TEXT') return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(value) {
    if (this.tagName === '#TEXT') { this._text = String(value); return; }
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    if (value !== '' && value !== null && value !== undefined) this.append(String(value));
  }
  get innerHTML() { return ''; }
  set innerHTML(value) { this._html = value; this.children = []; }

  querySelectorAll(selector) {
    const groups = String(selector).split(',').map((part) => part.trim()).filter(Boolean);
    const out = [];
    // One compound selector such as `section[aria-live="polite"].panel:not([disabled])`:
    // a tag, then any number of attribute, class, id and :not() parts.
    const matchOne = (node, compound) => {
      const parts = compound.match(/[a-zA-Z][a-zA-Z0-9-]*|\.[A-Za-z0-9_-]+|#[A-Za-z0-9_-]+|\[[^\]]*\]|:not\(\[[^\]]*\]\)/g) || [];
      if (!parts.length || parts.join('') !== compound) return false;
      for (const part of parts) {
        if (/^[a-zA-Z]/.test(part)) { if (node.tagName !== part.toUpperCase()) return false; continue; }
        if (part.startsWith('.')) { if (!(node.attributes.class || '').split(/\s+/).includes(part.slice(1))) return false; continue; }
        if (part.startsWith('#')) { if (node.attributes.id !== part.slice(1)) return false; continue; }
        if (part.startsWith(':not(')) { if (part.slice(5, -1) in node.attributes) return false; continue; }
        if (!attributeMatch(node, part)) return false;
      }
      return true;
    };
    const match = (node, compound) => compound.split(/\s+/).every((part) => matchOne(node, part));
    // Like a browser, the search covers the element itself as well as its
    // subtree (pack.querySelectorAll('button') finds pack's own children).
    const visit = (node) => {
      if (node.tagName === '#TEXT') return;
      if (groups.some((group) => match(node, group))) out.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return out;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class TextNode extends Node {
  constructor(doc, text) { super(doc, '#TEXT'); this._text = String(text); }
}

export function createDocument() {
  const doc = {
    activeElement: null,
    title: '',
    createElement(tag) { return new Node(doc, tag); },
    createTextNode(text) { return new TextNode(doc, text); },
    createElementNS(_ns, tag) { return new Node(doc, tag); },
    getElementById(id) { return doc.documentElement.querySelectorAll('[' + 'id' + '=' + id + ']')[0] || null; },
    dispatchEvent() { return true; },
    addEventListener() {},
    removeEventListener() {},
  };
  doc.documentElement = new Node(doc, 'html');
  doc.body = new Node(doc, 'body');
  doc.documentElement.append(doc.body);
  doc.head = new Node(doc, 'head');
  doc.documentElement.append(doc.head);
  return doc;
}

/** Install the stub globals the screens expect. Returns the document. */
export function installDom(hash = '#/practice') {
  const doc = createDocument();
  globalThis.Node = Node;
  globalThis.document = doc;
  globalThis.location = { hash, replace(target) { this.hash = target; } };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, language: 'en' }, configurable: true });
  return doc;
}

/** Every element under `root` whose text is exactly `text`. */
export function byText(root, text) {
  return root.querySelectorAll('button, a').filter((node) => node.textContent.trim() === text);
}
