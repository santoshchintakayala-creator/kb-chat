// Lightweight keyword retrieval over a knowledge base of question/answer entries.
// No dependencies, deterministic, fast enough for a few hundred entries.

const STOP = new Set(('a an and are as at be but by can could did do does doing for from had has have how i if in ' +
  'into is it its me my of on or our ours please should so that the their them there these they this to us ' +
  'was we were what when where which who why will with would you your yours about any get got just like need ' +
  'want im ive id dont does doesnt am then than too very also help question tell know thing things ' +
  'something anything really maybe hi hello hey thanks thank ok okay take accept method way kind type ' +
  'option sort use one ones').split(' '));

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9$]+/g, ' ')
    .trim();
}

function stem(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

export function tokenize(text) {
  return normalize(text).split(' ').filter(w => w && !STOP.has(w)).map(stem);
}

/** Build a search index once per knowledge base. */
export function buildIndex(kb) {
  const synonyms = new Map();
  for (const [word, alts] of Object.entries(kb.synonyms || {})) {
    synonyms.set(stem(normalize(word)), alts.map(a => tokenize(a)).flat());
  }
  const docs = (kb.qa || []).map((entry, i) => {
    const strong = new Set([...tokenize(entry.q), ...(entry.tags || []).flatMap(t => tokenize(t))]);
    const weak = new Set(tokenize(entry.a));
    return { i, entry, strong, weak, key: normalize(entry.q) };
  });
  const df = new Map();
  for (const d of docs) for (const t of new Set([...d.strong, ...d.weak])) df.set(t, (df.get(t) || 0) + 1);
  const n = Math.max(docs.length, 1);
  const idf = t => Math.log(1 + n / (1 + (df.get(t) || 0)));
  return { docs, synonyms, idf };
}

/**
 * Score every entry for a query; returns [{entry, score, coverage}] best first.
 * coverage = share of the query's meaningful words that the entry matched (directly or by synonym).
 */
export function search(index, query, k = 5) {
  const groups = [...new Set(tokenize(query))].map(t => [t, ...(index.synonyms.get(t) || [])]);
  if (!groups.length) return [];
  const scored = index.docs.map(d => {
    let score = 0, covered = 0;
    const counted = new Set();
    for (const group of groups) {
      let hit = false;
      for (const t of group) {
        if (d.strong.has(t)) { if (!counted.has(t)) score += 2 * index.idf(t); hit = true; }
        else if (d.weak.has(t)) { if (!counted.has(t)) score += 0.6 * index.idf(t); hit = true; }
        counted.add(t);
      }
      if (hit) covered++;
    }
    return { entry: d.entry, score, coverage: covered / groups.length };
  }).filter(r => r.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** Exact (normalized) match against a knowledge-base question, e.g. a tapped starter chip. */
export function exactMatch(index, query) {
  const key = normalize(query);
  return index.docs.find(d => d.key === key)?.entry || null;
}

const SMALL_TALK = /^(hi|hello|hey|hiya|good (morning|afternoon|evening)|thanks|thank you|thx|ok|okay|cool|great|bye|goodbye)\b[\s!.,?]*$/i;
export function isSmallTalk(text) {
  return SMALL_TALK.test(String(text || '').trim());
}
