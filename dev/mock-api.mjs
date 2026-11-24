// Development mock API and static file server for Trailpack.
//   node dev/mock-api.mjs [--port 8787]
// Implements API.md v1 with in memory data. Seeded with an owner account and
// one unused study code printed on start. Development only, no persistence.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createData, newCode, sha256 } from './mock-data.mjs';
import { HttpError, send, fail, authenticate, createUser, PEPPER } from './mock-lib.mjs';
import {
  handleHealth,
  handleAccessCheck,
  handleRedeem,
  handleLogin,
  handleRefresh,
  handleLogout,
  handleBootstrap,
} from './mock-auth.mjs';
import { handleMeGet, handleMePatch, handlePassword, handleDeleteMe } from './mock-me.mjs';
import {
  handleCodesCreate,
  handleCodesList,
  handleCodeRevoke,
  handleAccountsList,
  handleAccountPatch,
  handleAccountDelete,
  handleUsage,
  handleProviders,
} from './mock-admin.mjs';
import {
  handleChanges,
  handleGetDoc,
  handlePutDoc,
  handleDeleteDoc,
  handleFilePut,
  handleFileList,
  handleFileGet,
  handleFileDelete,
  handleSyncUsage,
  handleExport,
} from './mock-sync.mjs';
import { handleModels, handleChat, handleExtract } from './mock-llm.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1] || process.env.PORT || 8787);
const SEED = process.env.MOCK_SEED !== '0';
const DEMO_PASSWORD = ['a', 'demo', 'pass', 'phrase'].join('-');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.webp': 'image/webp',
};

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function jsonBody(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  return origin
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, content-type, x-file-name',
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        vary: 'origin',
      }
    : {};
}

async function serveStatic(pathname, req, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const target = normalize(join(ROOT, rel));
  if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    fail(res, 403, 'forbidden');
    return;
  }
  const blocked = ['/design/', '/dev/', '/.git/', '/node_modules/'];
  if (blocked.some((p) => rel.startsWith(p)) || rel.startsWith('/.')) {
    fail(res, 404, 'not_found');
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(target);
    send(res, 200, body, {
      'content-type': MIME[extname(target)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
  } catch {
    // SPA fallback for app routes (the app uses hash routes, but be safe).
    if (extname(rel) === '') {
      try {
        const html = await readFile(join(ROOT, 'index.html'));
        send(res, 200, html, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
        return;
      } catch {
        /* fall through */
      }
    }
    void req;
    fail(res, 404, 'not_found');
  }
}

async function handleApi(data, req, res, url) {
  const path = url.pathname.replace(/^\/api\/v1/, '');
  const method = req.method;
  const m = (re) => path.match(re);

  if (method === 'GET' && path === '/health') return handleHealth(data, res);
  if (method === 'POST' && path === '/access/check') return handleAccessCheck(data, req, res, await jsonBody(req));
  if (method === 'POST' && path === '/access/redeem') return handleRedeem(data, req, res, await jsonBody(req));
  if (method === 'POST' && path === '/auth/login') return handleLogin(data, req, res, await jsonBody(req));
  if (method === 'POST' && path === '/auth/refresh') return handleRefresh(data, req, res, await jsonBody(req));
  if (method === 'POST' && path === '/auth/logout') return handleLogout(data, req, res, await jsonBody(req));
  if (method === 'POST' && path === '/admin/bootstrap') return handleBootstrap(data, req, res, await jsonBody(req));

  // Everything below needs a signed in user.
  const user = authenticate(data, req);

  if (method === 'GET' && path === '/me') return handleMeGet(data, user, res);
  if (method === 'PATCH' && path === '/me') return handleMePatch(data, user, res, await jsonBody(req));
  if (method === 'POST' && path === '/me/password') return handlePassword(data, user, res, await jsonBody(req));
  if (method === 'DELETE' && path === '/me') return handleDeleteMe(data, user, res, await jsonBody(req));

  if (method === 'POST' && path === '/admin/codes') return handleCodesCreate(data, user, res, await jsonBody(req));
  if (method === 'GET' && path === '/admin/codes') return handleCodesList(data, user, res);
  let r = m(/^\/admin\/codes\/([A-Za-z0-9_-]+)$/);
  if (method === 'DELETE' && r) return handleCodeRevoke(data, user, res, r[1]);
  if (method === 'GET' && path === '/admin/accounts') return handleAccountsList(data, user, res);
  r = m(/^\/admin\/accounts\/([A-Za-z0-9_-]+)$/);
  if (method === 'PATCH' && r) return handleAccountPatch(data, user, res, r[1], await jsonBody(req));
  if (method === 'DELETE' && r) return handleAccountDelete(data, user, res, r[1]);
  if (method === 'GET' && path === '/admin/usage') return handleUsage(data, user, res, url);
  if (method === 'GET' && path === '/admin/providers') return handleProviders(data, user, res);

  if (method === 'GET' && path === '/sync/changes') return handleChanges(data, user, res, url);
  r = m(/^\/sync\/docs\/([a-z]+)\/([A-Za-z0-9_-]{1,64})$/);
  if (r && method === 'GET') return handleGetDoc(data, user, res, r[1], r[2]);
  if (r && method === 'PUT') return handlePutDoc(data, user, res, r[1], r[2], await jsonBody(req));
  if (r && method === 'DELETE') return handleDeleteDoc(data, user, res, r[1], r[2]);
  r = m(/^\/sync\/files\/([A-Za-z0-9_-]{1,64})$/);
  if (r && method === 'PUT') return handleFilePut(data, user, req, res, r[1], await readBody(req));
  if (r && method === 'GET') return handleFileGet(data, user, res, r[1]);
  if (r && method === 'DELETE') return handleFileDelete(data, user, res, r[1]);
  if (method === 'GET' && path === '/sync/files') return handleFileList(data, user, res);
  if (method === 'GET' && path === '/sync/usage') return handleSyncUsage(data, user, res);
  if (method === 'GET' && path === '/sync/export') return handleExport(data, user, res);

  if (method === 'POST' && path === '/ingest/extract') return handleExtract(data, req, res, await readBody(req, 20 * 1024 * 1024));
  if (method === 'GET' && path === '/llm/models') return handleModels(data, res);
  if (method === 'POST' && path === '/llm/chat') return handleChat(data, user, res, await jsonBody(req));

  throw new HttpError(404, 'not_found');
}

export function createMockServer(data = createData()) {
  return createServer(async (req, res) => {
    const cors = corsHeaders(req);
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      if (url.pathname.startsWith('/api/v1')) {
        await handleApi(data, req, res, url);
      } else {
        await serveStatic(url.pathname, req, res);
      }
    } catch (err) {
      if (err instanceof HttpError) fail(res, err.status, err.code, err.message);
      else {
        console.error(err);
        fail(res, 500, 'server_error');
      }
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = createData();
  // Fixed demo codes keep the smoke test repeatable. Codes are single use, so
  // the seed adds two unused ones: the second account (multi-device smoke)
  // redeems the second. Only the first is printed. Local mock only.
  const seedCodes = ['TRL-2345-6789-ABCD', 'TRL-2345-6789-ABCE'];
  let ownerEmail = '';
  let setupCode = '';
  if (SEED) {
    const owner = createUser(data, {
      name: 'Owner',
      email: 'owner@example.com',
      password: DEMO_PASSWORD,
      role: 'owner',
    });
    ownerEmail = owner.email;
    setupCode = seedCodes[0];
    seedCodes.forEach((code, i) => {
      const record = {
        id: 'code_seed' + (i === 0 ? '' : '_' + (i + 1)),
        hash: sha256(code + PEPPER),
        note: 'Dev seed code',
        dailyTokenBudget: 200000,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
        usedAt: null,
        revokedAt: null,
        usedByUserId: null,
      };
      data.codes.set(record.id, record);
    });
  }
  const server = createMockServer(data);
  server.listen(PORT, () => {
    console.log(`Trailpack mock API on http://localhost:${PORT}/api/v1`);
    console.log(`App: http://localhost:${PORT}/`);
    if (SEED) {
      console.log(`Owner login: ${ownerEmail} / ${DEMO_PASSWORD}`);
      console.log(`Unused study code: ${setupCode}`);
    }
  });
}
