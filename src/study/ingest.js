// Ingest runner: the one place that talks to the network for M2. It wires the
// pure helpers in `library.js` and `prompts.js` to the API client and the
// stores, and reports progress through a callback so the Library screen can
// show one line per document.
//
// No hidden work: each step is one request or one local write, and a failure is
// recorded on the source (state + error key) instead of throwing the run away.

import { mapRequest, generateRequest, parseJsonReply } from './prompts.js';

/** Ask the backend to extract text from bytes. */
export function makeIngest({ api, files }) {
  /**
   * Extract one source: POST /ingest/extract with the raw bytes, store the
   * original with /sync/files under the same id (when online), read the text.
   */
  async function extract(source, bytes) {
    const reply = await api.extract(bytes, { name: source.name, type: source.type });
    if (!reply || typeof reply.text !== 'string') throw new Error('empty_extract');
    // Keep the original so the citation can open it later; the file id doubles
    // as the source id, so a re-download needs no extra bookkeeping.
    if (files) {
      try {
        await files.save(source.id, new Blob([bytes], { type: source.type }));
        await api.putFile(source.id, bytes, { name: source.name, type: source.type });
      } catch {
        // Offline or over quota: the extracted text is still enough to study.
        source.localOnly = true;
      }
    }
    return reply;
  }

  /**
   * One `ingest_map` call for a batch of chunks. When the reply is not valid
   * JSON (usually cut off), the batch is split in two and each half retried,
   * and the replies are returned as a list. Callers fold every reply in.
   */
  async function map(chunks, pack) {
    const request = mapRequest(chunks, pack);
    const reply = await api.chat({ ...request });
    const text = reply && reply.text;
    const used = chunks.slice(0, request.chunkCount);
    if (parseJsonReply(text) !== null || used.length < 2) {
      return { text, chunks: request.chunkCount };
    }
    const half = Math.ceil(used.length / 2);
    const first = await map(used.slice(0, half), pack);
    const second = await map(used.slice(half), pack);
    return {
      text: first.text,
      chunks: first.chunks,
      more: [...(first.more || []), second, ...(second.more || [])],
    };
  }

  /** Variants for a batch of facts. */
  async function generate(facts, options = {}) {
    const request = generateRequest(facts, options);
    const reply = await api.chat({ ...request });
    return { text: reply && reply.text, factIds: request.factIds };
  }

  return { extract, map, generate };
}


