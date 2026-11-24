#!/usr/bin/env node
// Secret and private data scan. This repository is public, so the scan fails on:
//   - key like strings (sk-, pk_, AKIA, ghp_, xoxb-, private keys, long hex or base64 blobs)
//   - Bearer literals with a token after them
//   - email addresses (except reserved example domains)
//   - internal hostnames and private IPs
//   - obvious assignment of a real secret to a variable
//   - .env, key and token files tracked by git
// Exit code 1 on any finding. Run: node scripts/secret-scan.mjs

import { readdir, readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'design', 'dist', 'coverage']);
const SKIP_FILES = new Set(['package-lock.json']);

const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.zip', '.pdf']);

const RULES = [
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'bearer-literal', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/ },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { id: 'stripe-key', re: /\b(?:pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/ },
  { id: 'secret-assignment', re: /\b(?:api[_-]?key|secret|password|passwd|token|client[_-]?secret)\b\s*[:=]\s*['"][^'"\s{}$]{12,}['"]/i },
  { id: 'email', re: /[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|invalid)\b)(?!localhost\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, allow: /@(?:example\.(?:com|org|invalid)|localhost)/ },
  { id: 'private-ip', re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/ },
  { id: 'internal-host', re: /\b[A-Za-z0-9-]+\.(?:internal|local|corp|intranet|lan|home\.arpa)\b/i, allow: /localhost/i },
  { id: 'tenant-id', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { id: 'long-hex', re: /\b[0-9a-f]{40,}\b/i },
];

// Paths where test fixtures and the scanner itself legitimately talk about secrets.
const SELF = 'scripts/secret-scan.mjs';

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') {
      if (entry.isDirectory()) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

export function scanText(text, file = '') {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      if (rule.allow && rule.allow.test(m[0])) continue;
      if (file === SELF) continue;
      // Placeholders are allowed where the value is clearly not real.
      if (/example\.invalid|your-|placeholder|xxxx|••••|\$\{|<[a-z-]+>|dev-|devmock/i.test(m[0]) && rule.id !== 'email') continue;
      findings.push({ file, line: index + 1, rule: rule.id, match: m[0].slice(0, 80) });
    }
  });
  return findings;
}

async function trackedSecretFiles() {
  try {
    const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
    return out
      .split('\n')
      .filter(Boolean)
      .filter((f) => /(^|\/)(\.env(\..*)?|[^/]*\.(pem|key|p12|pfx)|[^/]*\.token)$/i.test(f));
  } catch {
    return [];
  }
}

export async function scan({ root = ROOT } = {}) {
  const findings = [];
  for await (const file of walk(root)) {
    const rel = relative(root, file).split('\\').join('/');
    if (SKIP_FILES.has(rel.split('/').pop())) continue;
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    if (BINARY.has(ext)) continue;
    if (rel === SELF) continue;
    let text;
    try {
      const info = statSync(file);
      if (info.size > 2 * 1024 * 1024) continue;
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    findings.push(...scanText(text, rel));
  }
  for (const f of await trackedSecretFiles()) {
    findings.push({ file: f, line: 1, rule: 'secret-file', match: f });
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = await scan();
  if (findings.length === 0) {
    console.log('secret scan: clean');
  } else {
    console.error(`secret scan: ${findings.length} finding(s)`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${f.match}`);
    process.exit(1);
  }
}
