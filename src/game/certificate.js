// The Summit certificate (design 4.7): what goes on it, and a small canvas
// painter that the screen hands to `<canvas>.toBlob('image/png')`.
//
// The data part is pure and tested. The painter takes a canvas context, so a
// browser draws it and a test can still check the layout description without a
// DOM. Colours come from a plain palette object the screen fills from the live
// CSS variables, never from hard coded literals here.

/** Certificate fields, derived from Trail and profile data. */
export const CERTIFICATE_VERSION = 1;

function dayOf(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysTaken(start, end) {
  const a = dayOf(start);
  const b = dayOf(end);
  if (!a || !b) return 0;
  const ms = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(1, Math.round((ms(b) - ms(a)) / 86_400_000) + 1);
}

/**
 * @param {{ packTitle?: string, learnerName?: string, startedAt?: string,
 *   finishedAt?: string, points?: number, lensCount?: number, campCount?: number,
 *   kind?: string }} trail
 */
export function certificateData(trail = {}) {
  const input = trail || {};
  const startedAt = dayOf(input.startedAt);
  const finishedAt = dayOf(input.finishedAt ?? Date.now());
  return {
    v: CERTIFICATE_VERSION,
    packTitle: String(trail.packTitle || 'Untitled pack').slice(0, 90),
    learnerName: String(trail.learnerName || '').slice(0, 60),
    startedAt,
    finishedAt,
    days: startedAt ? daysTaken(startedAt, finishedAt) : 0,
    points: Math.max(0, Math.round(Number(trail.points) || 0)),
    lensCount: Math.max(1, Math.round(Number(trail.lensCount) || 1)),
    campCount: Math.max(0, Math.round(Number(trail.campCount) || 0)),
    kind: trail.kind || 'other',
  };
}

/** Canvas size: A4 landscape at 150 dpi, a crisp PNG that still prints well. */
export const CERT_WIDTH = 1754;
export const CERT_HEIGHT = 1240;

/**
 * Layout for one width, in drawing order. Text and numbers only, so the screen
 * and a test agree on what the file shows.
 */
export function certificateLines(data, { width = CERT_WIDTH, height = CERT_HEIGHT } = {}) {
  const w = width;
  const h = height;
  const centre = w / 2;
  return [
    { key: 'brand', text: 'TRAILPACK', x: centre, y: h * 0.13, size: 34, weight: 700, letter: 10, role: 'muted', align: 'center' },
    { key: 'title', text: 'Summit Certificate', x: centre, y: h * 0.26, size: 74, weight: 700, role: 'text', align: 'center' },
    { key: 'awarded', text: 'Awarded for finishing the trail', x: centre, y: h * 0.34, size: 30, weight: 400, role: 'muted', align: 'center' },
    { key: 'name', text: data.learnerName || ' ', x: centre, y: h * 0.45, size: 58, weight: 600, role: 'spark', align: 'center' },
    { key: 'pack', text: data.packTitle, x: centre, y: h * 0.55, size: 44, weight: 500, role: 'text', align: 'center' },
    { key: 'dates', text: data.startedAt ? `${data.startedAt} to ${data.finishedAt} \u00b7 ${data.days} days` : String(data.finishedAt || ''), x: centre, y: h * 0.64, size: 26, weight: 400, role: 'muted', align: 'center' },
    { key: 'points', text: `${data.points} points`, x: w * 0.3, y: h * 0.75, size: 32, weight: 600, role: 'volt', align: 'center' },
    { key: 'camps', text: `${data.campCount} camps`, x: w * 0.5, y: h * 0.75, size: 32, weight: 600, role: 'summit', align: 'center' },
    { key: 'lenses', text: `${data.lensCount} lenses`, x: w * 0.7, y: h * 0.75, size: 32, weight: 600, role: 'orchid', align: 'center' },
    { key: 'foot', text: 'Study style is a Lens. Knowledge lives in the facts.', x: centre, y: h * 0.88, size: 22, weight: 400, role: 'muted', align: 'center' },
  ];
}

/**
 * Draw the certificate. `ctx` is a 2D context, `palette` maps the roles above
 * to concrete colour strings read from CSS variables by the caller.
 * Returns the lines it drew, so the screen can also put them in the alt text.
 */
export function drawCertificate(ctx, data, palette, { width = CERT_WIDTH, height = CERT_HEIGHT, fonts = {} } = {}) {
  const colour = (role) => (palette && palette[role]) || (palette && palette.text) || '#000';
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colour('page');
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = colour('surface');
  const inset = 40;
  const radius = 36;
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, radius);
  ctx.fill();
  ctx.strokeStyle = colour('spark');
  ctx.lineWidth = 6;
  roundRect(ctx, inset + 14, inset + 14, width - inset * 2 - 28, height - inset * 2 - 28, radius - 8);
  ctx.stroke();
  const lines = certificateLines(data, { width, height });
  const head = fonts.head || 'system-ui, sans-serif';
  for (const line of lines) {
    const spacing = line.letter || 0;
    ctx.fillStyle = colour(line.role);
    ctx.textAlign = line.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${line.weight || 400} ${line.size}px ${head}`;
    if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(line.text, line.x, line.y);
    if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  ctx.restore();
  return lines;
}

/** Rounded rectangle path, because `roundRect` is still not everywhere. */
export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** True when the Trail is finished, so the certificate can be offered. */
export function canIssueCertificate(trail = {}) {
  const camps = Array.isArray(trail.camps) ? trail.camps : [];
  if (!camps.length) return trail.summit === true;
  const done = camps.every((camp) => camp && (camp.state === 'summited' || camp.done === true));
  return done && trail.mockPassed !== false;
}

/** File name for the PNG download. */
export function certificateFileName(data) {
  const base = String(data.packTitle || 'trailpack')
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `${base || 'trailpack'}-certificate.png`;
}
