// Chunker: split extracted text into chunks of 150 to 400 words with a stable
// id and a source anchor (file, page). Pure JS, no DOM, no network.
//
// Rules:
// - Prefer to break at headings, blank lines and sentence ends.
// - A chunk is never shorter than `min` words unless it is the only or last
//   piece of a document, and never longer than `max` words.
// - Ids are derived from the source id, the page and the running index, so the
//   same document always chunks the same way (stable across re-ingests).

export const DEFAULT_CHUNK = { min: 150, max: 400 };

/** Clean extraction noise: joined hyphenation, page furniture, ragged spaces. */
export function cleanText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    // "exam-\nple" -> "example" (English style word hyphenation)
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A deterministic id: letters, digits, dash and underscore only. */
export function chunkId(sourceId, page, index) {
  const safeSource = String(sourceId || 'src').replace(/[^A-Za-z0-9_-]/g, '');
  return `${safeSource}_p${Number(page) || 1}_${index}`.slice(0, 64);
}

/** Sentence boundaries that survive abbreviations like "e.g." and "p. 4". */
export function splitSentences(paragraph) {
  const out = [];
  let start = 0;
  const re = /([.!?…])(["'”’)\]]?)\s+(?=[A-ZÀ-ÖØ-Þ0-9"“'([])/gu;
  let match;
  while ((match = re.exec(paragraph))) {
    const at = match.index + match[1].length + match[2].length;
    const piece = paragraph.slice(start, at).trim();
    // Do not break after common abbreviations or a single initial.
    if (/\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|no|fig|p|pp|approx|ca)\.$/i.test(piece) || /(^|\s)\p{Lu}\.$/u.test(piece)) {
      continue;
    }
    if (piece) out.push(piece);
    start = at;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * Units are paragraphs, and paragraphs longer than `max` are cut into
 * sentences; a single sentence longer than `max` is cut on word boundaries.
 */
function toUnits(pageText, max) {
  const units = [];
  for (const para of pageText.split(/\n{2,}/)) {
    const clean = para.trim();
    if (!clean) continue;
    const words = countWords(clean);
    if (words <= max) {
      units.push({ text: clean, words, boundary: true });
      continue;
    }
    for (const sentence of splitSentences(clean.replace(/\n/g, ' '))) {
      const count = countWords(sentence);
      if (count <= max) {
        units.push({ text: sentence, words: count, boundary: false });
      } else {
        let buf = [];
        let n = 0;
        for (const word of sentence.split(/\s+/)) {
          buf.push(word);
          n += 1;
          if (n >= max) {
            units.push({ text: buf.join(' '), words: n, boundary: false });
            buf = [];
            n = 0;
          }
        }
        if (buf.length) units.push({ text: buf.join(' '), words: n, boundary: false });
      }
    }
  }
  return units;
}

export function countWords(text) {
  const m = String(text || '').trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Cut text into pieces of at most `max` words, never losing a word. */
export function splitWords(text, max) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const pieces = [];
  for (let i = 0; i < words.length; i += max) pieces.push(words.slice(i, i + max).join(' '));
  return pieces;
}

/**
 * @param {{text: string, pages?: Array<{n: number, text: string}>}} doc cleaned extraction
 * @param {object} opts
 * @param {string} opts.sourceId
 * @param {{min?: number, max?: number}} [opts.limits]
 * @returns {Array<{id: string, source: string, page: number, index: number, words: number, text: string}>}
 */
export function chunkDocument(doc, { sourceId, limits = DEFAULT_CHUNK } = {}) {
  const min = limits.min ?? DEFAULT_CHUNK.min;
  const max = limits.max ?? DEFAULT_CHUNK.max;
  const pages = doc.pages && doc.pages.length ? doc.pages : [{ n: 1, text: doc.text || '' }];
  // Work across the whole document so a short tail of one page can join the
  // next page instead of becoming a stub. Each unit remembers its page.
  const units = [];
  pages.forEach((page, pageIndex) => {
    const pageNo = Number(page.n) || pageIndex + 1;
    for (const unit of toUnits(cleanText(page.text), max)) units.push({ ...unit, page: pageNo });
  });
  // Group units first, then balance the groups: a short last group borrows
  // units from the one before it, so no chunk (but the only one) is a stub.
  const groups = [];
  let buf = [];
  let words = 0;
  for (const unit of units) {
    if (words && words + unit.words > max) {
      groups.push({ units: buf, words });
      buf = [];
      words = 0;
    }
    buf.push(unit);
    words += unit.words;
    if (words >= min && unit.boundary) {
      groups.push({ units: buf, words });
      buf = [];
      words = 0;
    }
  }
  if (buf.length) groups.push({ units: buf, words });

  // A group over the cap holds a paragraph with no sentence ends at all; it is
  // cut on word boundaries, each piece a chunk of its own.
  const capped = [];
  for (const group of groups) {
    if (group.words <= max || group.units.length > 1) {
      capped.push(group);
      continue;
    }
    const unit = group.units[0];
    for (const piece of splitWords(unit.text, max)) {
      capped.push({ units: [{ ...unit, text: piece, words: countWords(piece) }], words: countWords(piece) });
    }
  }
  groups.splice(0, groups.length, ...capped);

  // A short last group borrows units from the one before it, so no chunk is a
  // stub (a document whose whole text is short is a single chunk).
  for (let i = groups.length - 1; i > 0; i -= 1) {
    const group = groups[i];
    if (group.words >= min) break;
    const prev = groups[i - 1];
    while (group.words < min && prev.units.length > 1 && prev.words - prev.units.at(-1).words >= min) {
      const moved = prev.units.pop();
      prev.words -= moved.words;
      group.units.unshift(moved);
      group.words += moved.words;
    }
    // Merge when whole units cannot help without breaking the previous chunk.
    if (group.words < min && prev.units.length > 1 && prev.words + group.words <= max) {
      prev.units.push(...group.units);
      prev.words += group.words;
      groups.splice(i, 1);
    }
  }

  // A short tail next to a single long run of words (text with no sentence
  // ends) is fixed at the word level: words move from the end of the
  // previous chunk to the start of this one.
  for (let i = groups.length - 1; i > 0 && groups[i].words < min; i -= 1) {
    const group = groups[i];
    const prev = groups[i - 1];
    if (prev.units.length > 1) continue;
    const need = Math.min(min - group.words, prev.words - min);
    if (need <= 0) continue;
    const donor = prev.units[0];
    const donorWords = donor.text.split(/\s+/);
    const moved = donorWords.splice(donorWords.length - need, need).join(' ');
    if (!moved) continue;
    donor.text = donorWords.join(' ');
    donor.words = countWords(donor.text);
    prev.words = donor.words;
    const target = group.units[0];
    target.text = moved + ' ' + target.text;
    target.words = countWords(target.text);
    group.words = group.units.reduce((n, u) => n + u.words, 0);
  }

  // Final pass: any non-last chunk still under `min` (a short group followed
  // by a long paragraph) merges with its neighbour when that fits, otherwise
  // takes words from the start of the next chunk.
  for (let i = 0; i < groups.length - 1; i += 1) {
    const group = groups[i];
    while (group.words < min && i < groups.length - 1) {
      const next = groups[i + 1];
      if (group.words + next.words <= max) {
        group.units.push(...next.units);
        group.words += next.words;
        groups.splice(i + 1, 1);
        continue;
      }
      const need = min - group.words;
      const head = next.units[0];
      const headWords = head.text.split(/\s+/);
      if (need >= headWords.length || next.words - need < Math.min(min, next.words)) {
        group.units.push(...next.units);
        group.words += next.words;
        groups.splice(i + 1, 1);
        continue;
      }
      const moved = headWords.splice(0, need).join(' ');
      head.text = headWords.join(' ');
      head.words = countWords(head.text);
      next.words = next.units.reduce((n, u) => n + u.words, 0);
      group.units.push({ ...head, text: moved, words: need });
      group.words += need;
    }
  }

  // A last chunk still under `min` takes words from the end of the previous
  // one (or merges when the two fit within `max`).
  while (groups.length > 1 && groups.at(-1).words < min) {
    const last = groups.at(-1);
    const prev = groups.at(-2);
    if (prev.words + last.words <= max) {
      prev.units.push(...last.units);
      prev.words += last.words;
      groups.pop();
      continue;
    }
    const need = Math.min(min - last.words, prev.words - min);
    const donor = prev.units.at(-1);
    const donorWords = donor.text.split(/\s+/);
    if (need <= 0 || need >= donorWords.length) break;
    const moved = donorWords.splice(donorWords.length - need, need).join(' ');
    donor.text = donorWords.join(' ');
    donor.words = countWords(donor.text);
    prev.words = prev.units.reduce((n, u) => n + u.words, 0);
    last.units.unshift({ ...donor, text: moved, words: need });
    last.words += need;
  }

  return groups.map((group, i) => ({
    id: chunkId(sourceId, group.units[0].page, i + 1),
    source: sourceId,
    page: group.units[0].page,
    index: i + 1,
    words: group.words,
    text: group.units.map((u) => u.text).join('\n\n'),
  }));
}

/**
 * Merge the chunks of several sources into one list, keeping order by source
 * and page (documents are processed in the order the user added them).
 */
export function chunkSources(sources, limits = DEFAULT_CHUNK) {
  const all = [];
  for (const source of sources) {
    const from = source.extract || { text: source.text || '', pages: source.pages };
    all.push(...chunkDocument(from, { sourceId: source.id, limits }));
  }
  return all;
}
