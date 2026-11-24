// ICU style message formatter, no dependencies, no DOM.
// Supported syntax inside a message:
//   {name}                                  simple placeholder
//   {count, plural, =0 {none} one {# item} other {# items}}
//   {d, number} / {d, number, percent}
//   {d, date} / {d, date, short} / {d, date, long}
//   {t, time} / {t, time, short}
// Apostrophes follow ICU: ' starts a quoted literal, '' is a literal apostrophe.
// Formats are chosen with Intl for the locale.

const DATE_STYLES = {
  short: { day: 'numeric', month: 'short' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  numeric: { day: 'numeric', month: 'numeric', year: 'numeric' },
  datetime: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
};

const TIME_STYLES = {
  short: { hour: '2-digit', minute: '2-digit' },
  medium: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
};

/**
 * Plural category for a count in a locale, using only the standard CLDR rules.
 * We do not depend on Intl.PluralRules being present for est/short, and we must
 * be correct for en, et, es, fr and fi. Intl.PluralRules is used when available
 * and falls back to a table otherwise.
 */
export function pluralCategory(locale, count) {
  const n = Math.abs(count);
  const i = Math.floor(n);
  const base = String(locale).split('-')[0].toLowerCase();
  if (typeof Intl !== 'undefined' && Intl.PluralRules) {
    try {
      return new Intl.PluralRules(base).select(count);
    } catch {
      /* fall through to the table */
    }
  }
  switch (base) {
    case 'fr':
      // French: 0 and 1 are "one" for integers (0 and 1), decimals are "other" up to 1e6.
      if (i === 0 || i === 1) return 'one';
      return 'other';
    case 'et':
    case 'fi':
    case 'en':
    case 'es':
    default:
      return n === 1 ? 'one' : 'other';
  }
}

/** Parse offset (start index) of a balanced {...} starting at `i` (i points at "{"). */
function findClose(message, i) {
  let depth = 0;
  let j = i;
  while (j < message.length) {
    const ch = message[j];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return j;
    }
    j += 1;
  }
  throw new Error('Unbalanced braces in message: ' + message);
}

/** Split by a top level comma (outside braces and quotes). */
function splitTop(text, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (ch === sep && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());
  return parts;
}

/** Parse a plural argument body: "plural, =0 {none} one {# item} other {# items}". */
function parseOptions(body) {
  const opts = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i += 1;
    const keyStart = i;
    while (i < body.length && !/\s/.test(body[i]) && body[i] !== '{') i += 1;
    const key = body.slice(keyStart, i);
    while (i < body.length && /\s/.test(body[i])) i += 1;
    if (body[i] !== '{') throw new Error('Plural option "' + key + '" has no message body');
    const close = findClose(body, i);
    opts.push({ key, body: body.slice(i + 1, close) });
    i = close + 1;
  }
  return opts;
}

function formatDate(locale, value, style = 'medium') {
  const d = value instanceof Date ? value : new Date(value);
  const opts = DATE_STYLES[style] || DATE_STYLES.medium;
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

function formatTime(locale, value, style = 'short') {
  const d = value instanceof Date ? value : new Date(value);
  const opts = TIME_STYLES[style] || TIME_STYLES.short;
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

function formatNumber(locale, value, style) {
  const n = Number(value);
  if (style === 'percent') return new Intl.NumberFormat(locale, { style: 'percent' }).format(n);
  return new Intl.NumberFormat(locale).format(n);
}

function interpolate(message, values, locale, depth = 0) {
  if (depth > 8) throw new Error('Message nesting too deep');
  let out = '';
  for (let i = 0; i < message.length; i += 1) {
    const ch = message[i];
    if (ch === "'") {
      // ICU quoting: '' is an apostrophe, '...' is a literal run.
      if (message[i + 1] === "'") {
        out += "'";
        i += 1;
      } else {
        const end = message.indexOf("'", i + 1);
        if (end === -1) {
          out += message.slice(i + 1);
          break;
        }
        out += message.slice(i + 1, end);
        i = end;
      }
      continue;
    }
    if (ch !== '{') {
      out += ch;
      continue;
    }
    const close = findClose(message, i);
    const inner = message.slice(i + 1, close);
    i = close;
    const parts = splitTop(inner, ',');
    const name = parts[0];
    if (parts.length === 1) {
      if (!(name in values)) throw new Error('Missing value for "' + name + '"');
      out += String(values[name]);
      continue;
    }
    const type = parts[1];
    const rest = parts.slice(2).join(',');
    if (!(name in values)) throw new Error('Missing value for "' + name + '"');
    const value = values[name];
    if (type === 'plural') {
      const options = parseOptions(rest.replace(/^plural\s*,\s*/, ''));
      const category = pluralCategory(locale, Number(value));
      const exact = '#';
      let chosen = options.find((o) => o.key === '=' + Number(value));
      if (!chosen) chosen = options.find((o) => o.key === category);
      if (!chosen) chosen = options.find((o) => o.key === 'other');
      if (!chosen) throw new Error('Plural "' + name + '" has no "other" form');
      const rendered = interpolate(chosen.body, values, locale, depth + 1);
      out += rendered.split(exact).join(formatNumber(locale, value));
    } else if (type === 'number') {
      out += formatNumber(locale, value, rest.trim() || undefined);
    } else if (type === 'date') {
      out += formatDate(locale, value, rest.trim() || undefined);
    } else if (type === 'time') {
      out += formatTime(locale, value, rest.trim() || undefined);
    } else if (type === 'select') {
      const options = parseOptions(rest.replace(/^select\s*,\s*/, ''));
      const chosen = options.find((o) => o.key === String(value)) || options.find((o) => o.key === 'other');
      if (!chosen) throw new Error('Select "' + name + '" has no match or "other"');
      out += interpolate(chosen.body, values, locale, depth + 1);
    } else {
      throw new Error('Unknown placeholder type "' + type + '"');
    }
  }
  return out;
}

/** Format one message in a locale. */
export function formatMessage(locale, message, values = {}) {
  return interpolate(String(message), values, locale);
}

/** Create a translator bound to one catalogue. Falls back to en, then to the key. */
export function createTranslator({ locale, catalogue, fallback = {}, onMissing = null }) {
  const t = (key, values = {}) => {
    const raw = catalogue[key];
    const fb = fallback[key];
    if (raw === undefined) {
      if (onMissing) onMissing(key);
      if (fb === undefined) return key;
      return formatMessage(locale, fb, values);
    }
    return formatMessage(locale, raw, values);
  };
  t.locale = locale;
  t.catalogue = catalogue;
  t.has = (key) => key in catalogue;
  t.date = (value, style) => formatDate(locale, value, style);
  t.time = (value, style) => formatTime(locale, value, style);
  t.number = (value, style) => formatNumber(locale, value, style);
  return t;
}

/** Keys that a translated catalogue is missing relative to the English one. */
export function missingKeys(english, translated) {
  const out = [];
  for (const key of Object.keys(english)) {
    if (key.startsWith('_')) continue;
    if (!(key in translated)) out.push(key);
  }
  return out.sort();
}

/** Placeholder names used by each message, so we can check translations keep them. */
export function placeholders(message) {
  const found = new Set();
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)/g;
  let m = re.exec(message);
  while (m) {
    found.add(m[1]);
    m = re.exec(message);
  }
  return [...found].sort();
}

export const LOCALES = ['en', 'et', 'es', 'fr', 'fi'];
export const LANGS = LOCALES;
