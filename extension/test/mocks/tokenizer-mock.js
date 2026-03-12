module.exports = {
  encodeText: async (text, maxLen = 128) => {
    // simple whitespace tokenizer -> map to small integer ids
    const words = text.trim().toLowerCase().split(/\s+/).slice(0, maxLen - 2);
    const ids = [101]; // CLS
    for (const w of words) ids.push(Math.abs(hashCode(w)) % 100 + 1000);
    ids.push(102); // SEP
    while (ids.length < maxLen) ids.push(0);
    const attentionMask = ids.map(v => (v === 0 ? 0 : 1));
    return { inputIds: ids, attentionMask };
  },
};

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return h;
}
