// Shortcuts: the skip wallet (design 4.5). Default 7, max 7, at most 2 per
// Camp, +1 earned for every 3 day streak award once per milestone. A Shortcut
// never skips a Checkpoint. Pure functions.

export const WALLET = {
  default: 7,
  max: 7,
  perCamp: 2,
  earnEvery: 3,
};

/** Item kinds a Shortcut may skip. Checkpoints and Summit mocks never. */
export const SKIPPABLE = ['step', 'bite', 'card', 'drill', 'boss', 'mock'];

export function emptyWallet(balance = WALLET.default) {
  return { balance: clamp(balance), earnedFor: 0, used: {} };
}

function clamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(WALLET.max, Math.max(0, Math.floor(n)));
}

export function walletBalance(wallet = {}) {
  return clamp(wallet.balance ?? WALLET.default);
}

/** Used in one Camp. `used` is `{ [campId]: count }`. */
export function usedInCamp(wallet = {}, campId) {
  const used = wallet.used || {};
  return Math.max(0, Number(used[campId]) || 0);
}

/** Can a Shortcut be spent on this item in this Camp right now? */
export function canSpend(wallet = {}, { campId, kind, isCheckpoint } = {}) {
  if (isCheckpoint) return { ok: false, reason: 'checkpoint' };
  if (!SKIPPABLE.includes(kind)) return { ok: false, reason: 'kind' };
  if (walletBalance(wallet) <= 0) return { ok: false, reason: 'empty' };
  if (usedInCamp(wallet, campId) >= WALLET.perCamp) return { ok: false, reason: 'camp' };
  return { ok: true, reason: null };
}

/**
 * Spend one Shortcut. Skipped items are remembered so the review queue can
 * bring them back before the Summit Mock.
 * @param {{ campId: string, kind: string, itemId: string, day: string }} item
 */
export function spend(wallet = {}, item, _now) {
  const check = canSpend(wallet, item);
  if (!check.ok) return { wallet, spent: false, reason: check.reason };
  const used = { ...(wallet.used || {}) };
  used[item.campId] = usedInCamp(wallet, item.campId) + 1;
  return {
    wallet: {
      balance: walletBalance(wallet) - 1,
      earnedFor: wallet.earnedFor || 0,
      used,
      skipped: [...(wallet.skipped || []), { id: item.itemId, campId: item.campId, kind: item.kind, at: item.day || null }],
    },
    spent: true,
    reason: null,
  };
}

/**
 * Award Shortcuts for day streak milestones. `earnedFor` records how many
 * milestones were already paid, so re-entering the app never double pays.
 */
export function earnForStreak(wallet = {}, dayStreak) {
  const milestones = Math.floor(Math.max(0, Number(dayStreak) || 0) / WALLET.earnEvery);
  const paid = Math.max(0, Number(wallet.earnedFor) || 0);
  if (milestones <= paid) return { wallet, gained: 0 };
  const gained = Math.min(milestones - paid, WALLET.max);
  return {
    wallet: { ...emptyWallet(walletBalance(wallet)), ...wallet, balance: clamp(walletBalance(wallet) + gained), earnedFor: milestones },
    gained,
  };
}

/** Items still owed to the review queue before the Summit Mock. */
export function skippedQueue(wallet = {}) {
  return [...(wallet.skipped || [])];
}
