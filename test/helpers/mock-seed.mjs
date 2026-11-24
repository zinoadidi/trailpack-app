// Seed data for the contract tests: one owner and a pool of unused codes.

import { createUser, PEPPER } from '../../dev/mock-lib.mjs';
import { newId, sha256 } from '../../dev/mock-data.mjs';

const OWNER_PASSWORD = ['owner', 'test', 'pass', 'phrase'].join('-');

export function createData() {
  return {
    ownerSetupToken: 'setup-token',
    now: () => Date.now(),
    users: new Map(),
    codes: new Map(),
    sessions: new Map(),
    docs: new Map(),
    files: new Map(),
    seq: 0,
    usage: [],
  };
}

export async function createSeed(data) {
  createUser(data, { name: 'Owner', email: 'owner@example.com', password: OWNER_PASSWORD, role: 'owner' });
  const unused = [];
  for (let i = 0; i < 40; i += 1) unused.push(mkCode(i + 1));
  data.seed = { code: unused.shift(), unused, ownerPassword: OWNER_PASSWORD };
  for (const code of [data.seed.code, ...unused]) {
    const id = newId('code');
    data.codes.set(id, {
      id,
      hash: sha256(code + PEPPER),
      note: '',
      dailyTokenBudget: 200000,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      usedAt: null,
      revokedAt: null,
      usedByUserId: null,
    });
  }
  return data.seed;
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function mkCode(i) {
  // Deterministic but distinct per index: the counter in 12 base 32 digits.
  const digits = Array.from({ length: 12 }, (_, pos) => Math.floor(i / 32 ** (11 - pos)) % 32);
  const body = digits.map((d) => ALPHABET[d]).join('');
  return `TRL-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}
