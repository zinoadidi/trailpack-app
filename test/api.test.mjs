// Drives dev/mock-api.mjs over HTTP with the real client, so the contract in
// API.md is checked end to end. Loopback only, no external network.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createMockServer } from '../dev/mock-api.mjs';
import { createData, createSeed } from './helpers/mock-seed.mjs';
import { createClient, ApiError } from '../src/api/client.js';

let server;
let base;
let data;
const PW = ['demo','pass','word'].join('-');

before(async () => {
  data = createData();
  await createSeed(data);
  server = createMockServer(data);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}/api/v1`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function client() {
  return createClient({ baseUrl: base });
}

test('health is public and leaks nothing', async () => {
  const res = await client().health();
  assert.equal(res.ok, true);
  assert.ok(res.version);
  assert.deepEqual(Object.keys(res).sort(), ['ok', 'time', 'version']);
});

test('access check and redeem with a seeded code', async () => {
  const api = client();
  const bad = await api.checkCode('TRL-ZZZZ-ZZZZ-ZZZZ').then(
    () => null,
    (e) => e,
  );
  assert.ok(bad instanceof ApiError);
  assert.equal(bad.code, 'invalid_code');
  assert.equal(bad.status, 400);

  const code = data.seed.code;
  assert.deepEqual(await api.checkCode(code), { ok: true });
  const session = await api.redeem({ code, name: 'Demo One', email: 'demo1@example.com', password: PW, lang: 'fr' });
  assert.equal(session.user.role, 'member');
  assert.equal(session.user.lang, 'fr');
  assert.ok(session.accessToken && session.refreshToken);
  assert.equal(session.user.passwordHash, undefined, 'no hashes in user');

  // Single use.
  const reuse = await api.checkCode(code).then(
    () => null,
    (e) => e,
  );
  assert.equal(reuse.code, 'invalid_code');
});

test('login, refresh rotation and reuse revocation', async () => {
  const code = data.seed.unused.pop() || mkCode();
  await client().redeem({ code, name: 'Demo Two', email: 'demo2@example.com', password: PW });
  const api = client();
  api.setAccessToken('stale-token'); // a 401 here must not trigger a refresh
  const fail = await api.login('demo2@example.com', 'wrong-password-here').then(
    () => null,
    (e) => e,
  );
  assert.equal(fail.code, 'invalid_credentials');

  const session = await api.login('demo2@example.com', PW);
  assert.ok(session.refreshToken);
  const next = await api.refresh(session.refreshToken);
  assert.notEqual(next.refreshToken, session.refreshToken, 'refresh tokens rotate');

  // Reusing the old token revokes the family, so the new one dies too.
  const reuse = await api.refresh(session.refreshToken).then(
    () => null,
    (e) => e,
  );
  assert.equal(reuse.status, 401);
  const deadFamily = await api
    .raw('/auth/refresh', { method: 'POST', body: { refreshToken: next.refreshToken } })
    .then(
      () => null,
      (e) => e,
    );
  assert.equal(deadFamily.status, 401);
});

test('me: read, patch and usage shape', async () => {
  const api = await signedIn('demo3@example.com');
  const me = await api.me();
  assert.deepEqual(Object.keys(me).sort(), ['usage', 'user']);
  assert.deepEqual(Object.keys(me.usage).sort(), ['budgetToday', 'tokensToday']);

  const patched = await api.updateMe({ theme: 'light', lang: 'fi', model: 'deepseek-flash' });
  assert.equal(patched.theme, 'light');
  assert.equal(patched.lang, 'fi');
  assert.equal(patched.model, 'deepseek-flash');

  const bad = await api.updateMe({ lang: 'de' }).then(
    () => null,
    (e) => e,
  );
  assert.equal(bad.code, 'invalid_lang');

  const badModel = await api.updateMe({ model: 'gpt' }).then(
    () => null,
    (e) => e,
  );
  assert.equal(badModel.code, 'invalid_model');
});

test('admin is owner only, codes are shown once', async () => {
  const member = await signedIn('demo4@example.com');
  const forbidden = await member.listCodes().then(
    () => null,
    (e) => e,
  );
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.code, 'forbidden');

  const owner = await ownerClient();
  const created = await owner.createCode({ note: 'For a friend', expiresInDays: 3 });
  assert.match(created.code, /^TRL(-[0-9A-Z]{4}){3}$/);
  const list = await owner.listCodes();
  assert.ok(list.every((c) => c.code === undefined), 'list never returns plaintext');
  const found = list.find((c) => c.id === created.id);
  assert.equal(found.status, 'unused');

  await owner.revokeCode(created.id);
  const after = (await owner.listCodes()).find((c) => c.id === created.id);
  assert.equal(after.status, 'revoked');

  const accounts = await owner.listAccounts();
  assert.ok(accounts.length >= 2);
  assert.ok(accounts.every((a) => typeof a.syncBytes === 'number' && typeof a.tokensToday === 'number'));

  const usage = await owner.usage(7);
  assert.ok(Array.isArray(usage.users) && Array.isArray(usage.models));
  const providers = await owner.providers();
  assert.equal(typeof providers.muse.configured, 'boolean');
  assert.equal(typeof providers.deepseekFlash.ok, 'boolean');
});

test('admin: suspend revokes sessions, last owner cannot be deleted', async () => {
  const victim = await signedIn('demo5@example.com');
  const owner = await ownerClient();
  const accounts = await owner.listAccounts();
  const target = accounts.find((a) => a.email === 'demo5@example.com');
  const patched = await owner.updateAccount(target.id, { status: 'suspended' });
  assert.equal(patched.status, 'suspended');
  const blocked = await victim.me().then(
    () => null,
    (e) => e,
  );
  assert.equal(blocked.status, 403);

  const owners = accounts.filter((a) => a.role === 'owner');
  const ownerId = owners[0].id;
  assert.equal(owners.length, 1);
  const last = await owner.deleteAccount(ownerId).then(
    () => null,
    (e) => e,
  );
  assert.equal(last.code, 'last_owner');
});

test('sync: put, conflict with baseRev, changes and tombstones', async () => {
  const api = await signedIn('demo6@example.com');
  const first = await api.putDoc('packs', 'p1', { title: 'Intro to project management' });
  assert.equal(first.rev, 1);
  assert.ok(first.seq > 0);

  const conflict = await api.putDoc('packs', 'p1', { title: 'Stale' }, first.rev - 1 || 'nope').then(
    () => null,
    (e) => e,
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, 'conflict');
  assert.equal(conflict.serverRev, 1);
  assert.equal(conflict.serverDoc.title, 'Intro to project management');

  await api.putDoc('facts', 'f1', { statement: 'A milestone marks a point in time' }, undefined);
  const changes = await api.getChanges(0);
  assert.equal(changes.changes.length, 2);
  assert.equal(changes.more, false);
  const cursor = changes.cursor;
  const none = await api.getChanges(cursor);
  assert.equal(none.changes.length, 0);

  await api.deleteDoc('facts', 'f1');
  const delta = await api.getChanges(cursor);
  assert.equal(delta.changes.length, 1);
  assert.equal(delta.changes[0].deleted, 1);
  assert.equal(delta.changes[0].doc, undefined);

  const gone = await api.getDoc('facts', 'f1').then(
    () => null,
    (e) => e,
  );
  assert.equal(gone.status, 404);

  const badCollection = await api.putDoc('users', 'u1', {}).then(
    () => null,
    (e) => e,
  );
  assert.equal(badCollection.status, 404);
  const badId = await api.putDoc('packs', 'bad id', {}).then(
    () => null,
    (e) => e,
  );
  assert.equal(badId.status, 404, 'an id with a space does not match the doc route');
});

test('sync: files and usage, export', async () => {
  const api = await signedIn('demo7@example.com');
  const bytes = new TextEncoder().encode('Course notes about milestones.');
  await api.putFile('file1', bytes, { name: 'notes.md', type: 'text/markdown' });
  const list = await api.listFiles();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'notes.md');
  assert.equal(list[0].size, bytes.length);
  const back = await api.getFile('file1');
  assert.equal(await back.text(), 'Course notes about milestones.');

  const usage = await api.syncUsage();
  assert.ok(usage.docs >= 0 && usage.bytes > 0 && usage.quotaBytes > 0);

  const exported = await api.syncExport();
  assert.equal(exported.user.name !== undefined, true);
  assert.ok(Array.isArray(exported.docs));
  await api.deleteFile('file1');
  assert.equal((await api.listFiles()).length, 0);
});

test('llm models and chat go through the server only', async () => {
  const api = await signedIn('demo8@example.com');
  const models = await api.models();
  assert.equal(models.default, 'muse');
  assert.ok(models.models.some((m) => m.id === 'muse'));
  assert.ok(models.models.some((m) => m.id === 'deepseek-flash'));
  const res = await api.chat({ task: 'other', messages: [{ role: 'user', content: 'hello' }], json: true });
  assert.ok(res.text);
  assert.ok(res.usage.inputTokens >= 0);
  assert.ok(res.budget.limit > 0);
});

test('delete account removes the user and their data', async () => {
  const api = await signedIn('demo9@example.com');
  await api.putDoc('notes', 'n1', { text: 'x' });
  const wrong = await api.deleteMe('not-the-password').then(
    () => null,
    (e) => e,
  );
  assert.equal(wrong.status, 400);
  await api.deleteMe(PW);
  const after = await api.me().then(
    () => null,
    (e) => e,
  );
  assert.equal(after.status, 401);
});

test('ingest extract reads text and refuses other types', async () => {
  const api = await signedIn('demo10@example.com');
  const bytes = new TextEncoder().encode('# Notes\nA milestone marks a point in time.');
  const out = await api.extract(bytes, { name: 'notes.md', type: 'text/markdown' });
  assert.match(out.text, /milestone/);
  assert.equal(out.meta.type, 'md');
  const refused = await api.extract(bytes, { name: 'deck.pptx', type: 'application/vnd.ms-powerpoint' }).then(
    () => null,
    (e) => e,
  );
  assert.equal(refused.status, 415);
});

test('a code already in use cannot be redeemed twice', async () => {
  const code = data.seed.unused.pop();
  const first = await client().redeem({ code, name: 'Demo', email: 'taken@example.com', password: PW });
  assert.ok(first.user.id);
  const again = await client()
    .redeem({ code, name: 'Other', email: 'other@example.com', password: PW })
    .then(
      () => null,
      (e) => e,
    );
  assert.equal(again.code, 'invalid_code');
  assert.equal(again.status, 400);
});

// ---------------------------------------------------------------- helpers

let counter = 0;
function mkCode() {
  counter += 1;
  return `TRL-${String(counter).padStart(4, '0')}-0000-0000`;
}

async function signedIn(email) {
  const api = client();
  const created = await api.redeem({ code: data.seed.unused.pop() || mkCode(), name: 'Demo', email, password: PW });
  api.setAccessToken(created.accessToken);
  return api;
}

async function ownerClient() {
  const api = client();
  const session = await api.login('owner@example.com', data.seed.ownerPassword);
  api.setAccessToken(session.accessToken);
  return api;
}
