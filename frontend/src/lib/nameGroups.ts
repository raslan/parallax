/**
 * Detects substrings repeated across many file names ("name groups") so a
 * pile of similarly named files can be selected in one go.
 *
 * Pure and framework-free: takes plain strings, returns a tree of groups.
 *
 * Algorithm (level-wise, Apriori style):
 *  - Work in Unicode code points so Hangul / CJK / emoji count as one unit.
 *  - Level 1 classes are single code points. A class at level L+1 is the pair
 *    (class of the length-L prefix, class of the next code point), keyed by an
 *    integer, so no substrings are ever materialised while counting.
 *  - A substring can only be frequent if both its prefix and its suffix are,
 *    so positions whose class is infrequent are dropped for every longer
 *    length. Work shrinks fast on real data and is bounded by
 *    names x positions x MAX_LENGTH in the worst case.
 *  - A class is redundant when a one-code-point extension (left or right) keeps
 *    the same file count: the longer one covers the same files.
 *  - Remaining groups with an identical file set are merged (longest text
 *    wins) and groups whose file set is a strict subset of another's are
 *    nested under the tightest such parent (bitset subset test).
 */

export type NameGroup = { text: string; count: number; children: NameGroup[] };

interface Options {
  minCount?: number;
  minLength?: number;
  /** Keep only the highest-count groups (default 500) so the tree step stays bounded. */
  maxGroups?: number;
}

const MAX_LENGTH = 40;
/**
 * Default cap on groups handed to the tree builder. Nesting is
 * O(groups^2 * names / 32) time and groups * names / 32 memory, and a person
 * can't usefully browse more than a few hundred suggestions anyway.
 */
const DEFAULT_MAX_GROUPS = 500;
const NO_FILES: number[] = []; // placeholder for classes that never reach minCount
const LETTER_RE = /\p{L}/u;
const EXT_RE = /\.[A-Za-z0-9]{1,5}$/;

interface Level {
  length: number;
  /** Per name: class id per start position, or -1 when dead. */
  cls: Int32Array[];
  count: number[];
  files: number[][];
  repName: number[];
  repPos: number[];
  prefix: number[];
  suffix: number[];
}

interface RawGroup {
  text: string;
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

export function detectNameGroups(names: string[], opts: Options = {}): NameGroup[] {
  const minCount = Math.max(2, opts.minCount ?? 5);
  const minLength = Math.max(1, opts.minLength ?? 2);
  if (names.length < minCount) return [];

  const maxGroups = Math.max(1, opts.maxGroups ?? DEFAULT_MAX_GROUPS);

  // NFC so a decomposed (macOS-style) Hangul name groups with its composed twin.
  const cps: number[][] = names.map((n) =>
    Array.from(n.normalize("NFC").replace(EXT_RE, ""), (c) => c.codePointAt(0)!),
  );

  // Level 1: single code points.
  const baseIds = new Map<number, number>();
  const l1: Level = {
    length: 1,
    cls: [],
    count: [],
    files: [],
    repName: [],
    repPos: [],
    prefix: [],
    suffix: [],
  };
  const lastSeen1: number[] = [];
  for (let n = 0; n < cps.length; n++) {
    const arr = cps[n]!;
    const ids = new Int32Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const cp = arr[i]!;
      let id = baseIds.get(cp);
      if (id === undefined) {
        id = l1.count.length;
        baseIds.set(cp, id);
        l1.count.push(0);
        l1.files.push([]);
        l1.repName.push(n);
        l1.repPos.push(i);
        l1.prefix.push(-1);
        l1.suffix.push(-1);
        lastSeen1.push(-1);
      }
      if (lastSeen1[id] !== n) {
        lastSeen1[id] = n;
        l1.count[id]!++;
        l1.files[id]!.push(n);
      }
      ids[i] = id;
    }
    l1.cls.push(ids);
  }
  for (const ids of l1.cls) {
    for (let i = 0; i < ids.length; i++) {
      if (l1.count[ids[i]!]! < minCount) ids[i] = -1;
    }
  }
  const base = l1.cls; // level-1 class per position, reused to extend every level
  const baseSize = l1.count.length;

  const raw: RawGroup[] = [];
  const emit = (lvl: Level, dominated: Uint8Array) => {
    if (lvl.length < minLength) return;
    for (let id = 0; id < lvl.count.length; id++) {
      if (lvl.count[id]! < minCount || dominated[id]) continue;
      const src = cps[lvl.repName[id]!]!;
      const text = String.fromCodePoint(
        ...src.slice(lvl.repPos[id]!, lvl.repPos[id]! + lvl.length),
      );
      // Digit / space / punctuation fragments (" 1", "_0") are noise, not suggestions.
      if (!LETTER_RE.test(text)) continue;
      raw.push({ text, length: lvl.length, files: lvl.files[id]! });
    }
  };

  let cur = l1;
  while (true) {
    const dominated = new Uint8Array(cur.count.length);
    let next: Level | null = null;
    if (cur.length < MAX_LENGTH) {
      const l = cur.length;
      const ids = new Map<number, number>();
      const nl: Level = {
        length: l + 1,
        cls: [],
        count: [],
        files: [],
        repName: [],
        repPos: [],
        prefix: [],
        suffix: [],
      };
      const lastSeen: number[] = [];
      let alive = false;
      for (let n = 0; n < cps.length; n++) {
        const pc = cur.cls[n]!;
        const bc = base[n]!;
        const len = cps[n]!.length;
        const out = new Int32Array(Math.max(0, len - l));
        for (let i = 0; i < out.length; i++) {
          const p = pc[i]!;
          const c = bc[i + l]!;
          const s = pc[i + 1]!;
          if (p < 0 || c < 0 || s < 0) {
            out[i] = -1;
            continue;
          }
          const key = p * baseSize + c;
          let id = ids.get(key);
          if (id === undefined) {
            id = nl.count.length;
            ids.set(key, id);
            nl.count.push(0);
            nl.files.push(NO_FILES);
            nl.repName.push(n);
            nl.repPos.push(i);
            nl.prefix.push(p);
            nl.suffix.push(s);
            lastSeen.push(-1);
          }
          if (lastSeen[id] !== n) {
            lastSeen[id] = n;
            nl.count[id]!++;
          }
          out[i] = id;
        }
        nl.cls.push(out);
      }
      // File lists are only built for frequent classes (most candidate classes
      // at deeper levels are not), in a second cheap pass with no map lookups.
      for (let id = 0; id < nl.count.length; id++) {
        if (nl.count[id]! >= minCount) nl.files[id] = [];
        lastSeen[id] = -1;
      }
      for (let n = 0; n < nl.cls.length; n++) {
        const out = nl.cls[n]!;
        for (let i = 0; i < out.length; i++) {
          const id = out[i]!;
          if (id < 0) continue;
          if (nl.count[id]! < minCount) {
            out[i] = -1;
            continue;
          }
          alive = true;
          if (lastSeen[id] !== n) {
            lastSeen[id] = n;
            nl.files[id]!.push(n);
          }
        }
      }
      if (alive) {
        for (let id = 0; id < nl.count.length; id++) {
          const c = nl.count[id]!;
          if (c < minCount) continue;
          if (c === cur.count[nl.prefix[id]!]) dominated[nl.prefix[id]!] = 1;
          if (c === cur.count[nl.suffix[id]!]) dominated[nl.suffix[id]!] = 1;
        }
        next = nl;
      }
    }
    emit(cur, dominated);
    if (!next) break;
    cur = next;
  }

  const texts = cps.map((arr) => String.fromCodePoint(...arr));
  return buildTree(dedupeEqualSets(raw, Math.max(2, minLength), texts), names.length, maxGroups);
}

/**
 * Join two texts when one contains the other or they overlap by at least
 * `minOverlap` code points (the 40-code-point cap splits a long shared string
 * into overlapping windows). Returns null for unrelated texts.
 */
function joinRelated(a: string, b: string, minOverlap: number): string | null {
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  const ca = Array.from(a);
  const cb = Array.from(b);
  const tryJoin = (x: string[], y: string[]): string | null => {
    for (let k = Math.min(x.length, y.length) - 1; k >= minOverlap; k--) {
      let ok = true;
      for (let i = 0; i < k; i++) {
        if (x[x.length - k + i] !== y[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return x.join("") + y.slice(k).join("");
    }
    return null;
  };
  return tryJoin(ca, cb) ?? tryJoin(cb, ca);
}

/**
 * Merge groups that cover exactly the same files AND are textually related
 * (substring / overlapping windows). Unrelated strings that merely share a
 * file set ("Paris_" and "_vacation") stay separate groups. An overlap join is
 * kept only when every member name really contains the joined text: two windows
 * ("aba", "bab") can share a file set while "abab" occurs in just one of them.
 *
 * `texts` are the normalised, extension-stripped names, indexed like `files`.
 */
function dedupeEqualSets(raw: RawGroup[], minOverlap: number, texts: string[]): RawGroup[] {
  // Longest first, then text order, so the result doesn't depend on input order.
  raw.sort((a, b) => b.length - a.length || compareText(a.text, b.text));
  const buckets = new Map<string, RawGroup[]>();
  for (let g of raw) {
    let h1 = 0;
    let h2 = 0;
    for (const f of g.files) {
      h1 = (h1 + f * 2654435761) % 4294967291;
      h2 = (h2 * 31 + f + 1) % 2147483629;
    }
    const key = `${g.files.length}:${h1}:${h2}`;
    const list = buckets.get(key);
    if (!list) {
      buckets.set(key, [g]);
      continue;
    }
    // Fold g into every related entry with the same file set.
    for (let i = 0; i < list.length; i++) {
      const o = list[i]!;
      if (!sameFiles(o.files, g.files)) continue;
      const joined = joinRelated(o.text, g.text, minOverlap);
      if (joined === null) continue;
      if (!g.files.every((f) => texts[f]!.includes(joined))) continue;
      g = { text: joined, length: Array.from(joined).length, files: g.files };
      list.splice(i, 1);
      i = -1; // the merged text may now relate to an earlier entry
    }
    list.push(g);
  }
  return [...buckets.values()].flat();
}

function buildTree(groups: RawGroup[], fileCount: number, maxGroups: number): NameGroup[] {
  groups.sort((a, b) => b.files.length - a.files.length || compareText(a.text, b.text));
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
