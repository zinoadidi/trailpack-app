// Pure helpers for the practice screen: variant lookup, the practice step
// shape, the match pairs and the deck. No DOM, tested in
// test/practice.test.mjs. The screen (practice.js) only draws what is here.

export const DECK_LIMIT = 8;

/** Strip a leading list marker ("2.", "2)", "II.", "b)") from an item. */
export function cleanDeckItem(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/^\s*(?:\d{1,3}[.)]|[ivxlcIVXLC]{1,6}[.)]|[a-zA-Z][.)])\s+/, '')
    .trim();
}

/** A deck from any list of strings: cleaned, empty and repeats dropped, capped. */
export function buildDeck(list, { limit = DECK_LIMIT } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const text = cleanDeckItem(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

/** Pair the deck into terms and meanings: even and odd items in order. */
export function pairDeck(deck) {
  const pairs = [];
  for (let i = 0; i + 1 < deck.length; i += 2) pairs.push({ term: deck[i], meaning: deck[i + 1] });
  return pairs;
}

/** Mechanics of one practice round: right, wrong, the run and the best run. */
export function roundStats() {
  let right = 0;
  let wrong = 0;
  let streak = 0;
  let best = 0;
  return {
    record(correct) {
      if (correct) {
        right += 1;
        streak += 1;
        best = Math.max(best, streak);
      } else {
        wrong += 1;
        streak = 0;
      }
      return { right, wrong, streak, best };
    },
    get() {
      return { right, wrong, streak, best, asked: right + wrong };
    },
  };
}

/** Deck position as a ratio 0..1, safe for an empty deck. */
export function deckProgress(index, total) {
  const count = Math.max(0, Number(total) || 0);
  const at = Math.max(0, Math.min(count, Number(index) || 0));
  return { index: at, total: count, ratio: count ? at / count : 0 };
}

/** Every variant of one type across the pack's facts, in fact order. */
export function variantsOf(facts, type) {
  const out = [];
  for (const fact of facts || []) {
    for (const variant of fact.variants || []) if (variant.type === type) out.push({ fact, variant });
  }
  return out;
}

/** One playable variant per fact for an activity's accepted formats. */
export function variantsForActivity(facts, formats, { limit = DECK_LIMIT } = {}) {
  const out = [];
  if (!Array.isArray(formats) || limit < 1) return out;
  for (const fact of facts || []) {
    const variant = (fact.variants || []).find((item) => formats.includes(item.type));
    if (!variant) continue;
    out.push({ fact, variant });
    if (out.length >= limit) break;
  }
  return out;
}

/** A pseudo step for a practice run: the activity contract without a bite. */
export function practiceStep(fact, variant, type, state = 'review') {
  return { factId: fact.id, type, variantId: variant.id, variant, state, shape: 'middle' };
}

/** The strings a listen round reads, from one variant and its fact. */
export function deckFor(fact, variant) {
  if (!variant) return [];
  return buildDeck([variant.transcript, variant.text, variant.front, fact ? fact.statement : '', ...(variant.items || [])], { limit: DECK_LIMIT });
}

/** Pairs for the match round: the variant's own, else term/meaning from the deck. */
export function pairsFor(fact, variant) {
  if (variant && Array.isArray(variant.pairs) && variant.pairs.length >= 2) return { ...variant, pairs: variant.pairs.slice(0, DECK_LIMIT) };
  const pairs = pairDeck(deckFor(fact, variant));
  return pairs.length >= 1 ? { ...variant, pairs } : null;
}
