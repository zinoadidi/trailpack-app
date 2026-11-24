// In memory data for the development mock API. Mirrors the contract in API.md.
// Deterministic seed users only, no real data, nothing persisted.

import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function newCode() {
  let out = 'TRL';
  for (let group = 0; group < 3; group += 1) {
    out += '-';
    for (let i = 0; i < 4; i += 1) out += CODE_ALPHABET[randomBytes(1)[0] % CODE_ALPHABET.length];
  }
  return out;
}

export function newId(prefix = '') {
  const id = randomUUID().replace(/-/g, '');
  return prefix ? `${prefix}_${id}` : id;
}

export const COLLECTIONS = [
  'packs',
  'facts',
  'topics',
  'lenses',
  'plans',
  'progress',
  'attempts',
  'settings',
  'notes',
  'generated',
];

export function createData({ ownerSetupToken = 'dev-setup-token', now = () => Date.now() } = {}) {
  return {
    ownerSetupToken,
    now,
    users: new Map(),
    codes: new Map(),
    sessions: new Map(), // refresh token hash -> {userId, family}
    docs: new Map(), // userId -> Map("collection/id" -> {rev,seq,deleted,updatedAt,doc})
    seq: 0,
    usage: [], // {userId, day, model, task, calls, tokens}
    files: new Map(), // userId -> Map(id -> {name,type,size,bytes,updatedAt})
  };
}
