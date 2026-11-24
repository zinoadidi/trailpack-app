#!/usr/bin/env node
// Render the PNG app icons from the SVG mark, with no dependencies.
// A tiny rasteriser: rounded square background, four polyline segments and the
// summit dot, sampled per pixel with 4x4 supersampling for smooth edges.
//   node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const COLORS = {
  bg: [0x15, 0x0c, 0x2e],
  lime: [0xc6, 0xf4, 0x32],
  orchid: [0xb8, 0x6b, 0xff],
  summit: [0xff, 0xc9, 0x3c],
};

// Trail shape in the 64x64 viewBox, as line segments.
const SEGMENTS = [
  [[12, 47], [34, 47]],
  [[34, 47], [26, 37]],
  [[26, 37], [46, 37]],
  [[46, 37], [38, 28]],
  [[38, 28], [50, 28]],
  [[50, 28], [50, 22]],
];
const DOT = { x: 50, y: 15, r: 6 };
const STROKE = 5;

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function pointInRoundedRect(x, y, size, radius, inset) {
  const min = inset;
  const max = size - inset;
  if (x < min || y < min || x > max || y > max) return false;
  const rx = Math.min(radius, max - min) - 0;
  const cx = Math.min(Math.max(x, min + rx), max - rx);
  const cy = Math.min(Math.max(y, min + rx), max - rx);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rx * rx;
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { d: Math.hypot(px - x, py - y), t };
}

function sample(u, v) {
  // u, v in 0..1 of the image. Coordinates scaled into the 64 unit viewBox.
  const x = u * 64;
  const y = v * 64;
  const angle = Math.min(1, Math.max(0, (y - 10) / 44));
  const trailColor = mix(COLORS.lime, COLORS.orchid, angle);
  const half = STROKE / 2;
  let color = null;
  let best = Infinity;
  for (const seg of SEGMENTS) {
    const hit = distToSegment(x, y, seg[0], seg[1]);
    if (hit.d <= half) {
      const t = Math.min(1, Math.max(0, (Math.max(seg[0][0], seg[1][0]) + 12 - 12) / 40));
      void t;
      color = trailColor;
    }
    best = Math.min(best, hit.d);
  }
  if (color) return [...color, 255];
  if ((x - DOT.x) ** 2 + (y - DOT.y) ** 2 <= DOT.r * DOT.r) return [...COLORS.summit, 255];
  if (pointInRoundedRect(x, y, 64, 16, 2)) return [...COLORS.bg, 255];
  void best;
  return [0, 0, 0, 0];
}

function render(size, { insetRatio = 0 } = {}) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  const inner = 1 - insetRatio * 2;
  const offset = size * insetRatio;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const u = (x + (sx + 0.5) / SS - offset) / (size * inner);
          const v = (y + (sy + 0.5) / SS - offset) / (size * inner);
          if (u < 0 || u > 1 || v < 0 || v > 1) continue;
          const c = sample(u, v);
          r += c[0] * (c[3] / 255);
          g += c[1] * (c[3] / 255);
          b += c[2] * (c[3] / 255);
          a += c[3];
        }
      }
      const n = SS * SS;
      const idx = (y * size + x) * 4;
      const alpha = a / n;
      px[idx] = alpha > 0 ? Math.round(r / (alpha / 255) / n) : 0;
      px[idx + 1] = alpha > 0 ? Math.round(g / (alpha / 255) / n) : 0;
      px[idx + 2] = alpha > 0 ? Math.round(b / (alpha / 255) / n) : 0;
      px[idx + 3] = Math.round(alpha);
    }
  }
  return px;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const jobs = [
  ['icons/icon-192.png', 192, {}],
  ['icons/icon-512.png', 512, {}],
  ['icons/maskable-512.png', 512, { insetRatio: 0.1 }],
  ['icons/apple-touch-icon.png', 180, {}],
];

for (const [file, size, opts] of jobs) {
  await writeFile(ROOT + file, png(size, render(size, opts)));
  console.log('wrote', file);
}
