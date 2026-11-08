// Caption + hashtag helpers shared by the browser UI and the Node server.
// Plain ES module with no dependencies so both sides run the exact same rules.

export const LIMITS = Object.freeze({
  instagramCaptionChars: 2200,
  instagramHashtags: 30,
  instagramMentions: 20,
  facebookTextChars: 63206,
});

// Letters, numbers, combining marks (needed for scripts such as Hindi) and underscore.
const TAG_CHAR = /^[\p{L}\p{N}\p{M}_]$/u;
const HASHTAG_IN_TEXT = /(^|[^\p{L}\p{N}\p{M}_&#])#([\p{L}\p{N}\p{M}_]+)/gu;
const MENTION_IN_TEXT = /(^|[^\p{L}\p{N}\p{M}_.@])@([A-Za-z0-9._]{1,30})/gu;

/**
 * Turn free-form input such as "sale, #Summer  #summer deals" or an array of
 * strings into a clean, de-duplicated list: ["#sale", "#Summer", "#deals"].
 */
export function normalizeHashtags(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/);
  const seen = new Set();
  const out = [];
  for (const raw of parts) {
    for (const piece of String(raw ?? '').normalize('NFC').split('#')) {
      const tag = Array.from(piece).filter((ch) => TAG_CHAR.test(ch)).join('');
      if (!tag) continue;
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`#${tag}`);
    }
  }
  return out;
}

export function extractHashtags(text) {
  return Array.from(String(text ?? '').matchAll(HASHTAG_IN_TEXT), (m) => `#${m[2]}`);
}

export function extractMentions(text) {
  return Array.from(String(text ?? '').matchAll(MENTION_IN_TEXT), (m) => `@${m[2]}`);
}

/**
 * Final text that gets posted: the caption, a blank line, then the hashtags.
 * Hashtags that are already written inside the caption are not repeated.
 */
export function buildPostText(caption, hashtags) {
  const body = String(caption ?? '').replace(/\r\n?/g, '\n').trim();
  const already = new Set(extractHashtags(body).map((t) => t.toLocaleLowerCase()));
  const extra = normalizeHashtags(hashtags).filter((t) => !already.has(t.toLocaleLowerCase()));
  if (!extra.length) return body;
  return body ? `${body}\n\n${extra.join(' ')}` : extra.join(' ');
}

export function analyzeText(text) {
  const t = String(text ?? '');
  return {
    chars: Array.from(t).length,
    hashtags: extractHashtags(t).length,
    mentions: extractMentions(t).length,
  };
}

/** Problems that would make Instagram reject the caption. Empty array = OK. */
export function instagramTextProblems(text) {
  const a = analyzeText(text);
  const problems = [];
  if (a.chars > LIMITS.instagramCaptionChars) {
    problems.push(`Instagram captions can be at most ${LIMITS.instagramCaptionChars} characters (this one has ${a.chars}).`);
  }
  if (a.hashtags > LIMITS.instagramHashtags) {
    problems.push(`Instagram allows at most ${LIMITS.instagramHashtags} hashtags (this post has ${a.hashtags}).`);
  }
  if (a.mentions > LIMITS.instagramMentions) {
    problems.push(`Instagram allows at most ${LIMITS.instagramMentions} @mentions (this post has ${a.mentions}).`);
  }
  return problems;
}

export function facebookTextProblems(text) {
  const a = analyzeText(text);
  return a.chars > LIMITS.facebookTextChars
    ? [`Facebook posts can be at most ${LIMITS.facebookTextChars} characters (this one has ${a.chars}).`]
    : [];
}
