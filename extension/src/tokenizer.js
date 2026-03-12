// src/tokenizer.js
// Tokenization for ourafla/mental-health-bert-finetuned using wink-tokenizer
// NOTE: This is an approximation: whole-word lookup into BERT vocab + [UNK].
// For exact WordPiece, you’d replace the mapping layer with a proper WordPiece segmenter.
// Use the bundled minimal tokenizer implementation for browser/service-worker usage.
import createTokenizer from './vendor/wink-tokenizer.mjs';
const wt = createTokenizer();

let vocab = null;
let vocabLoadPromise = null;
let clsId = null;
let sepId = null;
let padId = null;
let unkId = null;

async function loadVocab() {
  if (vocab) return;
  if (vocabLoadPromise) return vocabLoadPromise;

  vocabLoadPromise = (async () => {
    const nextVocab = new Map();

    const url = chrome.runtime.getURL(
      'models/mental-health-bert-finetuned-onnx/vocab.txt'
    );

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`[P.A.T.C.H] Failed to load vocab.txt: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/);

    lines.forEach((line, idx) => {
      const token = line.trim();
      if (!token) return;
      nextVocab.set(token, idx);
    });

    const nextClsId = nextVocab.get('[CLS]');
    const nextSepId = nextVocab.get('[SEP]');
    const nextPadId = nextVocab.get('[PAD]');
    const nextUnkId = nextVocab.get('[UNK]');

    if (
      nextClsId == null ||
      nextSepId == null ||
      nextPadId == null ||
      nextUnkId == null
    ) {
      throw new Error(
        '[P.A.T.C.H] Tokenizer error: missing [CLS]/[SEP]/[PAD]/[UNK] in vocab.txt'
      );
    }

    vocab = nextVocab;
    clsId = nextClsId;
    sepId = nextSepId;
    padId = nextPadId;
    unkId = nextUnkId;
  })();

  try {
    await vocabLoadPromise;
  } finally {
    vocabLoadPromise = null;
  }
}

/**
 * Encode text into input_ids and attention_mask.
 *
 * Note: this is still an approximation, not full Hugging Face WordPiece.
 */
export async function encodeText(text, maxLen = 128) {
  await loadVocab();

  const tokens = wt
    .tokenize((text || '').toLowerCase())
    .filter(t => t.tag === 'word' || t.tag === 'email' || t.tag === 'url')
    .map(t => t.value);

  const wordIds = tokens.map(tok => (vocab.has(tok) ? vocab.get(tok) : unkId));

  let ids = [clsId, ...wordIds, sepId];

  if (ids.length > maxLen) {
    ids = ids.slice(0, maxLen);
    ids[maxLen - 1] = sepId;
  }

  const attention = new Array(maxLen).fill(0);
  const tokenTypes = new Array(maxLen).fill(0);
  const realLen = Math.min(ids.length, maxLen);
  for (let i = 0; i < realLen; i++) attention[i] = 1;

  if (ids.length < maxLen) {
    ids = ids.concat(new Array(maxLen - ids.length).fill(padId));
  }

  const inputIds = new BigInt64Array(
    ids.map((id, index) => {
      if (id == null) {
        throw new Error(`[P.A.T.C.H] Null token id at input index ${index}`);
      }
      return BigInt(id);
    })
  );

  const attentionMask = new BigInt64Array(attention.map(val => BigInt(val)));
  const tokenTypeIds = new BigInt64Array(tokenTypes.map(val => BigInt(val)));
  return { inputIds, attentionMask, tokenTypeIds};
}
