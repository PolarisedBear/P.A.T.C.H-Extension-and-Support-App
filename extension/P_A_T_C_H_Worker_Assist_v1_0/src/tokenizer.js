// src/tokenizer.js
// Tokenization for ourafla/mental-health-bert-finetuned using wink-tokenizer
// NOTE: This is an approximation: whole-word lookup into BERT vocab + [UNK].
// For exact WordPiece, you’d replace the mapping layer with a proper WordPiece segmenter.
// Use the bundled minimal tokenizer implementation for browser/service-worker usage.
import createTokenizer from './vendor/wink-tokenizer.mjs';
const wt = createTokenizer();

let vocab = null;
let clsId = null;
let sepId = null;
let padId = null;
let unkId = null;

async function loadVocab() {
  if (vocab) return;

  vocab = new Map();

  const url = chrome.runtime.getURL('tokenizer/vocab.txt');
  const res = await fetch(url);
  const text = await res.text();

  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    const token = line.trim();
    if (!token) return;
    vocab.set(token, idx);
  });

  // Special tokens from ourafla/mental-health-bert-finetuned (bert-base-uncased style)
  clsId = vocab.get('[CLS]');
  sepId = vocab.get('[SEP]');
  padId = vocab.get('[PAD]');
  unkId = vocab.get('[UNK]');

  if (
    clsId === undefined ||
    sepId === undefined ||
    padId === undefined ||
    unkId === undefined
  ) {
    console.error(
      '[P.A.T.C.H] Tokenizer error: missing [CLS]/[SEP]/[PAD]/[UNK] in vocab.txt'
    );
  }
}

/**
 * Encode text into input_ids and attention_mask approximating
 * the tokenizer for ourafla/mental-health-bert-finetuned.
 *
 * - Lowercases text
 * - Uses wink-tokenizer for basic word splitting
 * - Looks up whole words in vocab.txt, falls back to [UNK]
 * - Adds [CLS] and [SEP]
 * - Pads/truncates to maxLen
 *
 * @param {string} text
 * @param {number} maxLen
 * @returns {Promise<{ inputIds: Int32Array, attentionMask: Int32Array }>}
 */
export async function encodeText(text, maxLen = 128) {
  await loadVocab();

  const tokens = wt
    .tokenize(text.toLowerCase())
    .filter(t => t.tag === 'word' || t.tag === 'email' || t.tag === 'url')
    .map(t => t.value);

  const wordIds = tokens.map(tok => {
    if (vocab.has(tok)) return vocab.get(tok);
    return unkId;
  });

  // Add [CLS] and [SEP]
  let ids = [clsId, ...wordIds, sepId];

  // Truncate
  if (ids.length > maxLen) {
    ids = ids.slice(0, maxLen);
    ids[maxLen - 1] = sepId;
  }

  // Attention mask: 1 for real tokens, 0 for padding
  const attention = new Array(maxLen).fill(0);
  const realLen = Math.min(ids.length, maxLen);
  for (let i = 0; i < realLen; i++) attention[i] = 1;

  // Pad with [PAD]
  if (ids.length < maxLen) {
    const padCount = maxLen - ids.length;
    ids = ids.concat(new Array(padCount).fill(padId));
  }

  const inputIds = new Int32Array(ids);
  const attentionMask = new Int32Array(attention);

  return { inputIds, attentionMask };
}
