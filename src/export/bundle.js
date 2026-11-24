// "Download all (ZIP)": the study guide, the cheat sheet and the Anki file of
// one Camp as a single archive. Pure apart from `zipStore`, so a node test can
// check the entry list and the archive structure without a DOM.

import { buildExport, exportCampOptions } from '../game/export.js';
import { zipStore } from '../export/zip.js';

/** Formats that go in the bundle, in the order they appear in the archive. */
export const BUNDLE_FORMATS = ['guide', 'cheatsheet', 'anki'];

const EXT = { guide: 'md', cheatsheet: 'md', anki: 'tsv' };

/** Lowercase ASCII fold, no path characters, never empty. */
export function bundleSlug(text, fallback = 'trailpack') {
  const slug = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60)
    .replace(/^-|-$/g, '');
  return slug || fallback;
}

function dayStamp(date) {
  const d = date instanceof Date ? date : new Date(date ?? Date.now());
  if (Number.isNaN(d.getTime())) return 'undated';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The same name every time for the same pack title, camp and day. */
export function zipFileName(pack = {}, { campId = null, date } = {}) {
  const base = bundleSlug(pack.title);
  return `${base}${campId ? '-camp-' + bundleSlug(campId) : '-all'}-${dayStamp(date)}.zip`;
}

/**
 * The archive's entries: `[{format, mime, text, name}]` plus the file name.
 * A format that builds to nothing is left out rather than written empty.
 */
export function bundleEntries(pack, { campId = null, date, lensTitle, lang } = {}) {
  const when = date instanceof Date ? date : new Date(date ?? Date.now());
  const camp = campId ? exportCampOptions(pack).find((option) => option.id === campId) : null;
  const campPart = camp && camp.title ? bundleSlug(camp.title, 'camp') : campId ? bundleSlug(campId) : 'all';
  const entries = [];
  for (const format of BUNDLE_FORMATS) {
    const built = buildExport(format, pack, { campId: campId || null, date: when, lensTitle, lang });
    if (!built || !built.text) continue;
    entries.push({
      format,
      mime: built.mime,
      text: built.text,
      name: `${format}-${campPart}.${EXT[format] || 'txt'}`,
    });
  }
  return { fileName: zipFileName(pack, { campId, date: when }), entries };
}

/** Bytes for the archive (UTF-8, no compression, eTag free names). */
export function zipBundle(pack, options = {}) {
  const { fileName, entries } = bundleEntries(pack, options);
  return { fileName, entries, bytes: zipStore(entries.map((entry) => ({ name: entry.name, data: entry.text }))) };
}
