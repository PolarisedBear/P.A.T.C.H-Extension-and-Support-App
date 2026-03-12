// Minimal bundled tokenizer compatible with wink-tokenizer's basic API.
// Provides a factory function that returns an object with `tokenize(text)`.
// This lightweight implementation recognizes URLs, emails, and words.

export default function createTokenizer() {
  const urlRe = /https?:\/\/[^\s"']+/i;
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const tokenRe = /https?:\/\/[^\s"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z0-9'’]+/g;

  return {
    tokenize(text = '') {
      if (typeof text !== 'string' || !text) return [];
      const tokens = [];
      const matches = text.match(tokenRe) || [];
      for (const m of matches) {
        if (urlRe.test(m)) tokens.push({ tag: 'url', value: m });
        else if (emailRe.test(m)) tokens.push({ tag: 'email', value: m });
        else tokens.push({ tag: 'word', value: m });
      }
      return tokens;
    }
  };
}
