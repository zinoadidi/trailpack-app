// Build the export strings and keep the "once per Camp per day" points honest.
// Pure, so the screen and a node test build the exact same file.

import { buildExport, exportFileName, exportCampOptions } from './export.js';
import { exportAward } from './points.js';

function dayOf(when) {
  const d = when instanceof Date ? when : new Date(when ?? Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * One export: the file text, its name, the points it earns and the log entry
 * to add when the user keeps it.
 *
 * @param {'guide'|'cheatsheet'|'anki'|'print'} format
 * @param {object} pack
 * @param {{ campId?: string|null, date?: Date|number, log?: Array<{camp, day}>,
 *   lensTitle?: string, lang?: string }} [options]
 */
export function prepareExport(format, pack, options = {}) {
  const date = options.date instanceof Date ? options.date : new Date(options.date ?? Date.now());
  const campId = options.campId || null;
  const built = buildExport(format, pack, { ...options, date, campId });
  if (!built) return null;
  const entry = { camp: campId || 'all', day: dayOf(date) };
  return {
    format,
    mime: built.mime,
    text: built.text,
    fileName: exportFileName(format, pack, { campId, date }),
    points: exportAward(entry, options.log || []),
    entry: { ...entry, format },
  };
}

export { exportCampOptions };
