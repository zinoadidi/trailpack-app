// Exports (design 3.6): Markdown study guide, one page cheat sheet, an Anki
// tab separated file and the print view. Pure string building over a Pack
// shaped object, so a node test can compare whole files.
//
// Nothing here reads the DOM: the screen turns these strings into a download
// or a print window. Every export carries the Pack title, the Lens name and the
// date in the footer, and every fact carries its source pointer.
// See ./README.md for the Pack shape.

export const EXPORT_FORMATS = ['guide', 'cheatsheet', 'anki', 'print', 'certificate'];

export const EXPORT_KEYS = {
  guide: 'export.guide',
  cheatsheet: 'export.cheatsheet',
  anki: 'export.anki',
  print: 'export.print',
  certificate: 'export.certificate',
};

function str(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function anchor(fact) {
  const source = fact.source || fact.anchor || {};
  const page = source.page ? ` p.${source.page}` : '';
  const name = source.name || source.file || '';
  return (name || page ? `${name}${page}` : '').trim();
}

function anchorSuffix(fact) {
  const where = anchor(fact);
  return where ? ` (${where})` : '';
}

function variants(fact) {
  return Array.isArray(fact.variants) ? fact.variants.filter((v) => v && typeof v === 'object') : [];
}

/** Front of an Anki card: the prompt of the first usable variant, else the fact. */
function cardFront(fact) {
  const list = variants(fact);
  const quiz = list.find((v) => v.type === 'quiz' || v.type === 'multiple-choice');
  if (quiz && (quiz.question || quiz.prompt)) return str(quiz.question || quiz.prompt);
  const flash = list.find((v) => v.type === 'flash' || v.type === 'flashcard');
  if (flash && flash.front) return str(flash.front);
  return str(fact.text || fact.statement || fact.id);
}

function cardBack(fact) {
  const list = variants(fact);
  const quiz = list.find((v) => v.type === 'quiz' || v.type === 'multiple-choice');
  if (quiz && quiz.answer !== undefined) {
    const answer = Array.isArray(quiz.answer) ? quiz.answer.join(', ') : str(quiz.answer);
    return str(fact.text) + (answer && answer !== str(fact.text) ? `\n\nAnswer: ${answer}` : '');
  }
  const flash = list.find((v) => v.type === 'flash' || v.type === 'flashcard');
  if (flash && flash.back) return str(flash.back);
  return str(fact.text || fact.statement || '');
}

/** Markdown needs a few characters escaped when they are not meant as markup. */
export function mdEscape(text) {
  return str(text).replace(/([\\`*_{}[\]<>])/g, '\\$1');
}

/** Strip tab and newline so a cell cannot break the TSV. */
export function tsvCell(text) {
  return str(text).replace(/\t/g, ' ').replace(/\r?\n+/g, ' ').replace(/"/g, '""').trim();
}

function dayStamp(date) {
  const d = date instanceof Date ? date : new Date(date ?? Date.now());
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function exportFooter(pack = {}, { date, lensTitle, lang } = {}) {
  const parts = [str(pack.title, 'Untitled pack')];
  if (lensTitle) parts.push(`Lens: ${lensTitle}`);
  if (lang) parts.push(lang);
  parts.push(dayStamp(date));
  return parts.join(' \u00b7 ');
}

/** Camps of a Pack, in trail order, with their facts. Unknown topics keep a trailing group. */
export function packCamps(pack = {}) {
  const topics = Array.isArray(pack.topics) ? pack.topics : [];
  const facts = Array.isArray(pack.facts) ? pack.facts : [];
  const camps = topics.map((topic, index) => ({
    id: str(topic.id, 'topic-' + (index + 1)),
    title: str(topic.title, 'Topic ' + (index + 1)),
    index,
    facts: facts.filter((fact) => fact.topicId === topic.id || fact.topic === topic.id),
  }));
  const known = new Set(camps.map((c) => c.id));
  const orphans = facts.filter((fact) => !known.has(fact.topicId || fact.topic));
  if (orphans.length) camps.push({ id: 'other', title: 'Other', index: camps.length, facts: orphans });
  return camps;
}

function campById(pack, campId) {
  const camps = packCamps(pack);
  if (!campId) return camps;
  const found = camps.filter((c) => c.id === campId);
  return found.length ? found : camps;
}

function sortFacts(facts = []) {
  return [...facts].sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0));
}

/**
 * Full study guide in Markdown with a table of contents, per topic, every fact
 * with its source pointer and its "explain the miss" note.
 */
export function studyGuide(pack = {}, { campId = null, date, lensTitle, lang } = {}) {
  const camps = campById(pack, campId);
  const lines = [];
  lines.push(`# ${mdEscape(pack.title || 'Study guide')}`, '');
  if (pack.goal) lines.push(`_${mdEscape(pack.goal)}_`, '');
  lines.push('## Contents', '');
  camps.forEach((camp, i) => lines.push(`${i + 1}. ${mdEscape(camp.title)} (${camp.facts.length})`));
  lines.push('');
  for (const camp of camps) {
    lines.push(`## ${mdEscape(camp.title)}`, '');
    if (!camp.facts.length) lines.push('_No facts in this camp yet._', '');
    for (const fact of sortFacts(camp.facts)) {
      const id = fact.id ? ` <sub>(${mdEscape(fact.id)})</sub>` : '';
      lines.push(`### ${mdEscape(str(fact.text || fact.statement))}${id}`, '');
      const back = cardBack(fact);
      if (back && back !== str(fact.text)) lines.push(mdEscape(back), '');
      const where = anchor(fact);
      if (where) lines.push(`> Source: ${mdEscape(where)}`, '');
      const wrong = fact.lastAttemptWrong ? `_Explain the miss: ${mdEscape(fact.lastAttemptWrong)}_` : '';
      if (wrong) lines.push(wrong, '');
    }
  }
  lines.push('---', '', `_${mdEscape(exportFooter(pack, { date, lensTitle, lang }))}_`, '');
  return lines.join('\n');
}

/**
 * One page cheat sheet: only the highest importance facts, one line each.
 * Intended for A4 print, so it stays short.
 */
export function cheatSheet(pack = {}, { campId = null, date, lensTitle, lang, limit = 12 } = {}) {
  const camps = campById(pack, campId);
  const max = Math.max(1, Math.min(40, Number(limit) || 12));
  const lines = [];
  lines.push(`# ${mdEscape(pack.title || 'Cheat sheet')}`, '');
  const all = sortFacts(camps.flatMap((camp) => camp.facts));
  const top = all.slice(0, max);
  if (!top.length) lines.push('_Nothing to summarise yet._', '');
  for (const fact of top) {
    const first = str(fact.text || fact.statement).split(/[.\n]/)[0];
    lines.push(`- ${mdEscape(first)}${anchorSuffix(fact) ? ` _(${mdEscape(anchor(fact))})_` : ''}`);
  }
  lines.push('', `_${mdEscape(exportFooter(pack, { date, lensTitle, lang }))}_`, '');
  return lines.join('\n');
}

/**
 * Anki import file: tab separated, no header, columns front, back, tags.
 * Tags are the topic and the camp, so Anki can filter per Camp.
 */
export function ankiFile(pack = {}, { campId = null, date } = {}) {
  void date;
  const camps = campById(pack, campId);
  const rows = [];
  for (const camp of camps) {
    for (const fact of sortFacts(camp.facts)) {
      const tags = [camp.id, str(pack.id, 'pack')].map((tag) => String(tag).replace(/\s+/g, '_')).join(' ');
      rows.push([tsvCell(cardFront(fact)), tsvCell(cardBack(fact) + (anchor(fact) ? ` (${anchor(fact)})` : '')), tags].join('\t'));
    }
  }
  return rows.join('\n') + (rows.length ? '\n' : '');
}

/**
 * Print view: a small HTML document with the print stylesheet inlined. It uses
 * only the token names of the app, so the print sheet is monochrome on purpose
 * (ink on paper) and independent of the chosen theme. Opened via window.print.
 */
export function printDocument(pack = {}, { campId = null, date, lensTitle, lang, title } = {}) {
  const camps = campById(pack, campId);
  const esc = (text) => str(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const body = camps
    .map((camp) => {
      const items = sortFacts(camp.facts)
        .map((fact) => `<li><b>${esc(fact.text || fact.statement)}</b>${anchor(fact) ? ` <span class="src">${esc(anchor(fact))}</span>` : ''}</li>`)
        .join('');
      return `<section><h2>${esc(camp.title)}</h2><ul>${items || '<li class="empty">-</li>'}</ul></section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="${esc(lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || pack.title || 'Trailpack')}</title>
<style>
  @page { margin: 18mm; }
  body { font: 12pt/1.5 ui-sans-serif, system-ui, sans-serif; color: #000; background: #fff; }
  h1 { font-size: 20pt; margin: 0 0 4mm; }
  h2 { font-size: 14pt; margin: 8mm 0 2mm; page-break-after: avoid; }
  ul { padding-left: 5mm; }
  li { margin-bottom: 2mm; }
  .src { color: #555; font-size: 9pt; }
  footer { margin-top: 10mm; border-top: 1px solid #555; padding-top: 2mm; font-size: 9pt; color: #555; }
</style>
</head>
<body>
<h1>${esc(pack.title || 'Trailpack')}</h1>
${body}
<footer>${esc(exportFooter(pack, { date, lensTitle, lang }))}</footer>
</body>
</html>`;
}

/** Pick the right builder by format id. */
export function buildExport(format, pack, options = {}) {
  switch (format) {
    case 'guide':
      return { format, mime: 'text/markdown', text: studyGuide(pack, options) };
    case 'cheatsheet':
      return { format, mime: 'text/markdown', text: cheatSheet(pack, options) };
    case 'anki':
      return { format, mime: 'text/tab-separated-values', text: ankiFile(pack, options) };
    case 'print':
      return { format, mime: 'text/html', text: printDocument(pack, options) };
    default:
      return null;
  }
}

/** A safe file name: pack title, camp and date, no path characters. */
export function exportFileName(format, pack = {}, { campId = null, date } = {}) {
  const base = [str(pack.title, 'trailpack'), campId ? 'camp-' + campId : 'all']
    .join('-')
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
  const ext = { guide: 'md', cheatsheet: 'md', anki: 'tsv', print: 'html', certificate: 'png' }[format] || 'txt';
  return `${base || 'trailpack'}-${dayStamp(date)}.${ext}`;
}

/** The Camps a Pack offers in the export picker: "All camps" plus each one. */
export function exportCampOptions(pack = {}) {
  return [{ id: null, title: 'All camps', facts: (pack.facts || []).length }, ...packCamps(pack).map((camp) => ({ id: camp.id, title: camp.title, facts: camp.facts.length }))];
}
