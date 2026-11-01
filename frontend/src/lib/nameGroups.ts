/**
 * Suggests words and phrases shared by many file names ("name groups") so a
 * pile of similarly named files can be selected with one `name contains` filter.
 *
 * Pure and framework-free: takes plain strings, returns a tree of groups.
 *
 * Algorithm:
 *  - Names are NFC-normalised, extension stripped, and split into atoms: runs of
 *    letters (apostrophes inside a word kept), runs of digits, and runs of a
 *    script written without spaces (Hangul, Han, kana, Thai, ...). Letter/digit
 *    and camelCase steps are atom boundaries too ("x264" = "x" + "264").
 *  - Candidates are 1-5 word phrases of whole atoms (glued atoms are one word),
 *    sliced verbatim from the name, joined only over soft separators (space _ . -).
 *    Edges must be real words: >= 3 letters, a glued compound ("x264", "S01"),
 *    or a digit run; never letters wedged between digits (hex). Stopwords are
 *    never chips and sit at an edge only of a 3+ word title ("The Truth About").
 *    Lone digit runs only count as 4-digit years. Inside spaceless runs,
 *    substrings of >= 2 code points are mined level-wise (Apriori pruning).
 *  - Candidates are counted per distinct name, case-insensitively (the most
 *    common casing is shown), then the best are re-counted exactly the way the
 *    `name contains` filter matches, over the full lower-cased names.
 *  - Candidates in >= 90% of a non-tiny folder are dropped; equal file sets
 *    collapse to the longest text; strict subsets nest under the tightest parent.
 */

export type NameGroup = { text: string; count: number; children: NameGroup[] };

/** Messages for `nameGroups.worker.ts`; the worker just calls `detectNameGroups`. */
export type NameGroupsRequest = { requestId: number; names: string[] };
export type NameGroupsResponse = { requestId: number; groups: NameGroup[] };

interface Options {
  /** Minimum files per group. Default scales with the folder: max(5, 0.5% of names). */
  minCount?: number;
  /** Minimum length (code points) of a word in a space-delimited script. Default 3. */
  minLength?: number;
  /** Keep only the highest-count groups (default 500) so the tree step stays bounded. */
  maxGroups?: number;
}

/** Longest suggestion, in code points. */
const MAX_LENGTH = 40;
/** Words per phrase (a glued compound such as "1080p" counts as one word). */
const MAX_WORDS = 5;
const MAX_ATOMS = 10;
/** Longest substring mined inside a run of a script written without spaces. */
const MAX_SPACELESS = 12;
/**
 * Default cap on groups handed to the tree builder. Nesting is
 * O(groups^2 * names / 32) time and groups * names / 32 memory, and a person
 * can't usefully browse more than a few hundred suggestions anyway.
 */
const DEFAULT_MAX_GROUPS = 500;
/** How many candidates (x maxGroups) get the exact `contains` re-count. */
const VERIFY_FACTOR = 4;
/** Below this many names a word shared by (nearly) all of them is still shown. */
const TINY_FOLDER = 20;
const COMMON_SHARE = 0.9;
const EXT_RE = /\.[A-Za-z0-9]{1,5}$/;
const SPACELESS_RE =
  /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}ー々]/u;
const LETTER_RE = /\p{L}/u;
const MARK_RE = /\p{M}/u;
const DIGIT_RE = /\p{Nd}/u;
const UPPER_RE = /\p{Lu}/u;
const LOWER_RE = /\p{Ll}/u;
const SOFT_SEP_RE = /^[\s_.,+&~-]{1,3}$/u;

/** Never a suggestion on their own, nor at either end of a phrase. */
const STOPWORDS = new Set(
  [
    // English articles, prepositions, conjunctions, pronouns, auxiliaries.
    "the and for nor but yet with from into onto upon over under about above after",
    "before than then that this these those there here what when where which while",
    "who whom whose why how are was were been being has have had does did can could",
    "will would shall should may might must not all any some its it's his her hers him",
    "she they them their theirs you your yours our ours mine via per out off",
    "also just very too only own same such each both few more most other",
    // Trivial release junk: so common in media names that it filters nothing.
    "video videos audio official www com http https",
  ]
    .join(" ")
    .split(" "),
);

const KIND_LETTER = 0;
const KIND_DIGIT = 1;
const KIND_SPACELESS = 2;

interface Atom {
  /** UTF-16 offsets into the normalised, extension-stripped name. */
  s: number;
  e: number;
  kind: number;
  /** Length in code points (marks included). */
  len: number;
}

interface Candidate {
  key: string;
  /** Number of distinct names that produced it (a lower bound of the real count). */
  count: number;
  last: number;
  text: string;
  /** Per-casing name counts, created only once a second casing shows up. */
  casings: Map<string, number> | null;
  /** Exact matching names when already known (spaceless substrings), else re-counted. */
  files?: number[];
}

interface RawGroup {
  text: string;
  key: string;
  length: number;
  files: number[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sameFiles(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function cpLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0xd800 || c > 0xdbff) n++;
  }
  return n;
}

/** -1 separator, -2 combining mark, else a KIND_*. ASCII is decided without regexes. */
function charKind(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c < 128) {
    if (c >= 48 && c <= 57) return KIND_DIGIT;
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return KIND_LETTER;
    return -1;
  }
  if (MARK_RE.test(ch)) return -2;
  if (DIGIT_RE.test(ch)) return KIND_DIGIT;
  if (SPACELESS_RE.test(ch)) return KIND_SPACELESS;
  if (LETTER_RE.test(ch)) return KIND_LETTER;
  return -1;
}

const isUpper = (ch: string) => {
  const c = ch.charCodeAt(0);
  return c < 128 ? c >= 65 && c <= 90 : UPPER_RE.test(ch);
};
const isLower = (ch: string) => {
  const c = ch.charCodeAt(0);
  return c < 128 ? c >= 97 && c <= 122 : LOWER_RE.test(ch);
};

function tokenize(text: string): Atom[] {
  const chars = Array.from(text);
  const atoms: Atom[] = [];
  let cur = null as Atom | null; // (cast: TS loses loop narrowing here)
  let prev = "";
  let off = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const w = ch.length;
    let kind = charKind(ch);
    if (kind === -2) {
      // A combining mark belongs to the atom it follows.
      if (cur) {
        cur.e = off + w;
        cur.len++;
      }
      off += w;
      continue;
    }
    if (kind === -1 && (ch === "'" || ch === "’") && cur?.kind === KIND_LETTER) {
      const next = chars[i + 1];
      if (next !== undefined && charKind(next) === KIND_LETTER) kind = KIND_LETTER; // "Don't"
    }
    if (kind === -1) {
      cur = null;
      prev = "";
      off += w;
      continue;
    }
    let split = cur === null || cur.kind !== kind;
    if (!split && kind === KIND_LETTER && prev) {
      const next = chars[i + 1];
      if (isLower(prev) && isUpper(ch))
        split = true; // camelCase
      else if (isUpper(prev) && isUpper(ch) && next !== undefined && isLower(next)) split = true; // HTMLParser
    }
    if (split) {
      cur = { s: off, e: off + w, kind, len: 1 };
      atoms.push(cur);
    } else {
      cur!.e = off + w;
      cur!.len++;
    }
    prev = ch;
    off += w;
  }
  return atoms;
}

function isYear(text: string, a: Atom): boolean {
  if (a.len !== 4) return false;
  const y = Number(text.slice(a.s, a.e));
  return y >= 1900 && y <= 2100;
}

export function detectNameGroups(names: string[], opts: Options = {}): NameGroup[] {
  const minCount = Math.max(2, opts.minCount ?? Math.max(5, Math.ceil(names.length * 0.005)));
  if (names.length < minCount) return [];
  const minLength = Math.max(1, opts.minLength ?? 3);
  const maxGroups = Math.max(1, opts.maxGroups ?? DEFAULT_MAX_GROUPS);

  const pool = new Map<string, Candidate>();
  const add = (t: string, n: number) => {
    if (t.length > MAX_LENGTH && cpLength(t) > MAX_LENGTH) return;
    const key = t.toLowerCase();
    let c = pool.get(key);
    if (!c) {
      c = { key, count: 0, last: -1, text: t, casings: null };
      pool.set(key, c);
    }
    if (c.last === n) return;
    c.last = n;
    c.count++;
    if (c.casings === null && t !== c.text) c.casings = new Map([[c.text, c.count - 1]]);
    if (c.casings) c.casings.set(t, (c.casings.get(t) ?? 0) + 1);
  };

  // Runs of spaceless scripts, mined for inner substrings after the phrase pass.
  const runs: { n: number; cps: string[] }[] = [];

  // NFC so a decomposed (macOS-style) Hangul name groups with its composed twin.
  const nfc = names.map((n) => n.normalize("NFC"));
  for (let n = 0; n < nfc.length; n++) {
    const text = nfc[n]!.replace(EXT_RE, "");
    const atoms = tokenize(text);
    const m = atoms.length;
    const glued = (i: number) => i >= 0 && i + 1 < m && atoms[i]!.e === atoms[i + 1]!.s;
    // Letters wedged between glued digits ("9fca3") are hex noise, not a word.
    const wedged = (i: number) =>
      atoms[i]!.kind === KIND_LETTER &&
      glued(i - 1) &&
      glued(i) &&
      atoms[i - 1]!.kind === KIND_DIGIT &&
      atoms[i + 1]!.kind === KIND_DIGIT;
    const stop = (a: Atom) =>
      a.kind === KIND_LETTER && STOPWORDS.has(text.slice(a.s, a.e).toLowerCase());
    const strong = (a: Atom, outsideGlued: boolean) =>
      a.kind === KIND_LETTER
        ? a.len >= minLength
        : a.kind === KIND_SPACELESS
          ? a.len >= 2
          : !outsideGlued || a.len >= 4;
    /** Can atom `i` end a multi-atom phrase? (Stopword edges are judged by the caller.) */
    const edgeOk = (i: number, outsideGlued: boolean, insideGlued: boolean) => {
      const a = atoms[i]!;
      if (wedged(i)) return false;
      if (stop(a)) return !outsideGlued;
      if (strong(a, outsideGlued)) return true;
      return !outsideGlued && insideGlued; // "x" of "x264", "S" of "S01"
    };

    for (let i = 0; i < m; i++) {
      const first = atoms[i]!;
      if (first.kind === KIND_SPACELESS && first.len >= 2) {
        runs.push({ n, cps: Array.from(text.slice(first.s, first.e)) });
      }
      const leftOut = glued(i - 1);
      let words = 1;
      let content = false;
      // A real word inside: a non-stopword of >= minLength letters, or spaceless text.
      let hasWord = false;
      for (let j = i; j < m && j < i + MAX_ATOMS; j++) {
        const a = atoms[j]!;
        if (j > i) {
          const prev = atoms[j - 1]!;
          if (prev.e !== a.s) {
            if (!SOFT_SEP_RE.test(text.slice(prev.e, a.s))) break;
            if (++words > MAX_WORDS) break;
          }
        }
        if (a.e - first.s > 2 * MAX_LENGTH) break;
        content ||= a.kind !== KIND_DIGIT || isYear(text, a);
        hasWord ||=
          a.kind === KIND_SPACELESS || (a.kind === KIND_LETTER && a.len >= minLength && !stop(a));
        if (!content) continue;
        const rightOut = glued(j);
        if (i === j) {
          // A single word: a real word or a year, never a stopword or bare counter.
          const ok =
            a.kind === KIND_DIGIT ? isYear(text, a) : strong(a, true) && !stop(a) && !wedged(i);
          if (ok) add(text.slice(a.s, a.e), n);
          continue;
        }
        if (!edgeOk(i, leftOut, glued(i)) || !edgeOk(j, rightOut, glued(j - 1))) continue;
        // "The Truth About" is a title; "holiday the" / "of the" are noise.
        if ((stop(first) || stop(a)) && (words < 3 || !hasWord)) continue;
        add(text.slice(first.s, a.e), n);
      }
    }
  }

  // Substrings inside spaceless runs, level-wise: a length-k substring can only
  // be frequent if both its length-(k-1) prefix and suffix are, and one whose
  // count equals a one-longer extension's covers the same names (dominated).
  // keys[r][p] is the substring of run r at position p for the current length,
  // or null once pruned. Any occurrence of a purely spaceless key lies inside
  // such a run (case mapping leaves these scripts alone), so these counts and
  // file lists are already exact and skip the re-count below.
  let keys: (string | null)[][] = runs.map((r) =>
    Array.from({ length: r.cps.length - 1 }, (_, p) => r.cps[p]! + r.cps[p + 1]!),
  );
  let level = countLevel(runs, keys, minCount);
  for (let k = 2; level.size > 0; k++) {
    let nextKeys: (string | null)[][] = [];
    let next: Map<string, LevelCount> = new Map();
    if (k < MAX_SPACELESS) {
      nextKeys = runs.map((r, ri) => {
        const cur = keys[ri]!;
        const out: (string | null)[] = [];
        for (let p = 0; p + 1 < cur.length; p++) {
          const pre = cur[p]!;
          const suf = cur[p + 1]!;
          out.push(
            pre !== null && suf !== null && level.has(pre) && level.has(suf)
              ? pre + r.cps[p + k]!
              : null,
          );
        }
        return out;
      });
      next = countLevel(runs, nextKeys, minCount);
      for (let ri = 0; ri < runs.length; ri++) {
        const cur = keys[ri]!;
        const nk = nextKeys[ri]!;
        for (let p = 0; p < nk.length; p++) {
          const key = nk[p];
          const ext = key ? next.get(key) : undefined;
          if (!ext) continue;
          // Both parents are frequent, or this extension would not exist.
          const pre = level.get(cur[p]!)!;
          const suf = level.get(cur[p + 1]!)!;
          if (pre.count === ext.count) pre.dominated = true;
          if (suf.count === ext.count) suf.dominated = true;
        }
      }
    }
    for (const [key, v] of level) {
      // A dominated key's longer extension covers the same names; skip its re-count.
      if (v.dominated) pool.delete(key);
      else
        pool.set(key, { key, count: v.count, last: -1, text: key, casings: null, files: v.files });
    }
    keys = nextKeys;
    level = next;
  }

  // Exact re-count of the strongest candidates, the way `name contains` matches:
  // case-insensitive over the full NFC name (extension included).
  const ranked = [...pool.values()].filter((c) => c.count >= minCount);
  ranked.sort(
    (a, b) => b.count - a.count || b.key.length - a.key.length || compareText(a.key, b.key),
  );
  if (ranked.length > VERIFY_FACTOR * maxGroups) ranked.length = VERIFY_FACTOR * maxGroups;
  const lowered = nfc.map((n) => n.toLowerCase());
  const starts = new Int32Array(lowered.length + 1);
  for (let i = 0; i < lowered.length; i++) starts[i + 1] = starts[i]! + lowered[i]!.length + 1;
  const big = lowered.join("\u0000");
  const common = names.length >= TINY_FOLDER ? COMMON_SHARE * names.length : Infinity;

  const raw: RawGroup[] = [];
  for (const c of ranked) {
    const files: number[] = c.files ?? [];
    let lo = 0;
    for (let pos = c.files ? -1 : big.indexOf(c.key); pos >= 0;) {
      // Matches come in order, so the owning name is found by moving forward.
      let hi = lowered.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (starts[mid]! <= pos) lo = mid;
        else hi = mid - 1;
      }
      files.push(lo);
      pos = big.indexOf(c.key, starts[lo + 1]!);
    }
    if (files.length < minCount || files.length >= common) continue;
    raw.push({ text: displayText(c), key: c.key, length: cpLength(c.key), files });
  }

  return buildTree(dedupeEqualSets(raw, lowered), names.length, maxGroups);
}

interface LevelCount {
  count: number;
  last: number;
  dominated: boolean;
  /** Ascending indices of the names containing the key. */
  files: number[];
}

/** Distinct-name counts of one substring length; only the frequent ones are kept. */
function countLevel(
  runs: { n: number }[],
  keys: (string | null)[][],
  minCount: number,
): Map<string, LevelCount> {
  const counts = new Map<string, LevelCount>();
  for (let ri = 0; ri < runs.length; ri++) {
    const n = runs[ri]!.n;
    for (const key of keys[ri]!) {
      if (key === null) continue;
      let v = counts.get(key);
      if (!v) {
        v = { count: 0, last: -1, dominated: false, files: [] };
        counts.set(key, v);
      }
      if (v.last !== n) {
        v.last = n;
        v.count++;
        v.files.push(n);
      }
    }
  }
  for (const [key, v] of counts) if (v.count < minCount) counts.delete(key);
  return counts;
}

/** The casing most names use; ties go to the first in code-unit order. */
function displayText(c: Candidate): string {
  if (!c.casings) return c.text;
  let best = c.text;
  let bestCount = -1;
  for (const [t, k] of c.casings) {
    if (k > bestCount || (k === bestCount && compareText(t, best) < 0)) {
      best = t;
      bestCount = k;
    }
  }
  return best;
}

/**
 * Join two texts when one contains the other or they overlap by at least
 * `minOverlap` code points (MAX_WORDS / MAX_LENGTH split a long shared title
 * into overlapping windows). Works on lower-cased keys; returns the joined key
 * and display text, or null for unrelated texts.
 */
function joinRelated(
  a: RawGroup,
  b: RawGroup,
  minOverlap: number,
): { key: string; text: string } | null {
  if (a.key.includes(b.key)) return a;
  if (b.key.includes(a.key)) return b;
  const tryJoin = (x: RawGroup, y: RawGroup): { key: string; text: string } | null => {
    const xk = Array.from(x.key);
    const yk = Array.from(y.key);
    const xt = Array.from(x.text);
    const yt = Array.from(y.text);
    // Case mapping can change the length of a few characters; skip those.
    if (xk.length !== xt.length || yk.length !== yt.length) return null;
    for (let k = Math.min(xk.length, yk.length) - 1; k >= minOverlap; k--) {
      let ok = true;
      for (let i = 0; i < k; i++) {
        if (xk[xk.length - k + i] !== yk[i]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        return { key: x.key + yk.slice(k).join(""), text: x.text + yt.slice(k).join("") };
      }
    }
    return null;
  };
  return tryJoin(a, b) ?? tryJoin(b, a);
}

/**
 * Merge groups that cover exactly the same files AND are textually related
 * (containment / overlapping windows), keeping the longer text. Unrelated
 * words that merely share a file set ("Paris" and "vacation") stay separate.
 * An overlap join is kept only when every member name really contains it.
 *
 * `lowered` are the lower-cased NFC names, indexed like `files`.
 */
function dedupeEqualSets(raw: RawGroup[], lowered: string[]): RawGroup[] {
  // Longest first, then text order, so the result doesn't depend on input order.
  raw.sort((a, b) => b.length - a.length || compareText(a.key, b.key));
  const buckets = new Map<string, RawGroup[]>();
  for (let g of raw) {
    let h1 = 0;
    let h2 = 0;
    for (const f of g.files) {
      h1 = (h1 + f * 2654435761) % 4294967291;
      h2 = (h2 * 31 + f + 1) % 2147483629;
    }
    const bucketKey = `${g.files.length}:${h1}:${h2}`;
    const list = buckets.get(bucketKey);
    if (!list) {
      buckets.set(bucketKey, [g]);
      continue;
    }
    // Fold g into every related entry with the same file set.
    for (let i = 0; i < list.length; i++) {
      const o = list[i]!;
      if (!sameFiles(o.files, g.files)) continue;
      const joined = joinRelated(o, g, 3);
      if (joined === null) continue;
      if (!g.files.every((f) => lowered[f]!.includes(joined.key))) continue;
      g = { text: joined.text, key: joined.key, length: cpLength(joined.key), files: g.files };
      list.splice(i, 1);
      i = -1; // the merged text may now relate to an earlier entry
    }
    list.push(g);
  }
  return [...buckets.values()].flat();
}

function buildTree(groups: RawGroup[], fileCount: number, maxGroups: number): NameGroup[] {
  // Higher count first, then the longer (more specific) text, then text order.
  groups.sort(
    (a, b) => b.files.length - a.files.length || b.length - a.length || compareText(a.text, b.text),
  );
  if (groups.length > maxGroups) groups.length = maxGroups;
  const m = groups.length;
  const words = Math.ceil(fileCount / 32);
  const bits = new Uint32Array(m * words);
  for (let g = 0; g < m; g++) {
    for (const f of groups[g]!.files) bits[g * words + (f >>> 5)]! |= 1 << (f & 31);
  }

  const nodes: NameGroup[] = groups.map((g) => ({
    text: g.text,
    count: g.files.length,
    children: [],
  }));
  const roots: NameGroup[] = [];

  for (let g = 0; g < m; g++) {
    const mine = groups[g]!;
    const first = mine.files[0]!;
    const firstWord = first >>> 5;
    const firstBit = 1 << (first & 31);
    let parent = -1;
    // Sorted by count desc, so walking backwards finds the tightest parent first.
    for (let j = g - 1; j >= 0; j--) {
      if (groups[j]!.files.length === mine.files.length) continue;
      if ((bits[j * words + firstWord]! & firstBit) === 0) continue;
      let subset = true;
      for (let w = 0; w < words; w++) {
        if ((bits[g * words + w]! & ~bits[j * words + w]!) !== 0) {
          subset = false;
          break;
        }
      }
      if (subset) {
        parent = j;
        break;
      }
    }
    if (parent < 0) roots.push(nodes[g]!);
    else nodes[parent]!.children.push(nodes[g]!);
  }
  return roots;
}

/**
 * Narrow groups by a typed string (case-insensitive contains). A group that
 * matches keeps its whole subtree; otherwise it survives only through
 * matching descendants.
 */
export function filterGroups(groups: NameGroup[], typed: string): NameGroup[] {
  const q = typed.normalize("NFC").trim().toLowerCase();
  if (!q) return groups;
  const walk = (list: NameGroup[]): NameGroup[] => {
    const out: NameGroup[] = [];
    for (const g of list) {
      if (g.text.toLowerCase().includes(q)) {
        out.push(g);
        continue;
      }
      const kids = walk(g.children);
      if (kids.length > 0) out.push({ ...g, children: kids });
    }
    return out;
  };
  return walk(groups);
}
