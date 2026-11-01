import { describe, it, expect } from "vitest";
import { detectNameGroups, filterGroups, type NameGroup } from "./nameGroups";

const many = (n: number, make: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => make(i));

function flat(groups: NameGroup[]): NameGroup[] {
  return groups.flatMap((g) => [g, ...flat(g.children)]);
}

const textsOf = (names: string[], opts?: Parameters<typeof detectNameGroups>[1]) =>
  flat(detectNameGroups(names, opts)).map((g) => g.text);

/** Small deterministic PRNG (mulberry32) so generated corpora are reproducible. */
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(rnd: () => number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += "0123456789abcdef"[Math.floor(rnd() * 16)];
  return out;
}

const pick = <T>(rnd: () => number, list: readonly T[]): T =>
  list[Math.floor(rnd() * list.length)]!;
const pad = (n: number, w: number) => String(n).padStart(w, "0");

// --- Realistic corpora -------------------------------------------------------

const GROUPS = ["SubsPlease", "Erai-raws", "HorribleSubs", "YTS", "RARBG"];
const ARTISTS = ["aespa", "NewJeans", "IVE", "Taylor Swift", "Daft Punk", "Radiohead"];
const TITLES = [
  "Supernova",
  "Midnight City",
  "Night of the Living Dead",
  "Hold the Line",
  "Bad Habits",
  "Spicy",
  "Golden Hour",
  "Fly Me to the Moon",
];
const QUALITY = ["1080p", "720p", "2160p"];
const CODEC = ["x264", "x265", "HEVC"];

/** `[Group] Artist - Title (2023) [1080p].mkv`-style release names. */
function releases(n: number, seed: number): string[] {
  const rnd = prng(seed);
  return many(n, (i) => {
    const year = 2015 + Math.floor(rnd() * 9);
    return `[${pick(rnd, GROUPS)}] ${pick(rnd, ARTISTS)} - ${pick(rnd, TITLES)} (${year}) [${pick(
      rnd,
      QUALITY,
    )}] ${pick(rnd, CODEC)} ${pad(i, 4)}.mkv`;
  });
}

/** Camera names: `IMG_2021_0412_153012.jpg`, `PXL_20230801_...`, `DSC01234.JPG`. */
function cameraRoll(n: number, seed: number): string[] {
  const rnd = prng(seed);
  return many(n, (i) => {
    const y = 2019 + Math.floor(rnd() * 5);
    const md = `${pad(1 + Math.floor(rnd() * 12), 2)}${pad(1 + Math.floor(rnd() * 28), 2)}`;
    const t = pad(Math.floor(rnd() * 240000), 6);
    const r = rnd();
    if (r < 0.5) return `IMG_${y}_${md}_${t}.jpg`;
    if (r < 0.8) return `PXL_${y}${md}_${t}${pad(i % 1000, 3)}.jpg`;
    return `DSC${pad(i, 5)}.JPG`;
  });
}

const WORDS = [
  "holiday",
  "birthday",
  "party",
  "beach",
  "wedding",
  "concert",
  "garden",
  "mountain",
  "family",
  "dinner",
  "night",
  "morning",
  "trip",
  "school",
  "graduation",
];
const FILLER = ["the", "of", "and", "with", "at", "in", "my", "our", "a", "to"];

/** Plain English sentence-ish names: `my beach trip with the family 0042.mp4`. */
function sentences(n: number, seed: number): string[] {
  const rnd = prng(seed);
  return many(n, (i) => {
    const parts = Array.from({ length: 3 + Math.floor(rnd() * 4) }, (_, k) =>
      k % 2 ? pick(rnd, FILLER) : pick(rnd, WORDS),
    );
    return `${parts.join(" ")} ${pad(i, 4)}.mp4`;
  });
}

const KO = ["에스파", "카리나", "윈터", "닝닝", "지젤", "뉴진스", "하니", "민지"];
const KO_KIND = ["직캠", "무대", "브이로그", "인터뷰", "영상"];

/** Mixed Korean + English names, both spaced and glued Hangul. */
function koreanMixed(n: number, seed: number): string[] {
  const rnd = prng(seed);
  return many(n, (i) => {
    const a = pick(rnd, KO);
    const b = pick(rnd, KO_KIND);
    return rnd() < 0.5
      ? `${a} ${b} ${pick(rnd, ["fancam", "stage", "4K"])} ${pad(i, 4)}.mp4`
      : `${a}${b}_${pad(i, 4)}.mp4`;
  });
}

/** `something_edited.jpg` / `x - Copy.png` suffix-shaped names. */
function sharedSuffix(n: number, seed: number): string[] {
  const rnd = prng(seed);
  return many(n, () => {
    const base = `${pick(rnd, WORDS)}_${hex(rnd, 6)}`;
    const r = rnd();
    if (r < 0.3) return `${base}_edited.jpg`;
    if (r < 0.5) return `${base} - Copy.jpg`;
    if (r < 0.6) return `${base}_thumbnail.png`;
    return `${base}.jpg`;
  });
}

function realisticMix(n: number, seed: number): string[] {
  const k = Math.floor(n / 5);
  return [
    ...releases(k, seed),
    ...cameraRoll(k, seed + 1),
    ...sentences(k, seed + 2),
    ...koreanMixed(k, seed + 3),
    ...sharedSuffix(n - 4 * k, seed + 4),
  ];
}

/** Every emitted text must really match exactly `count` names via `name contains`. */
function expectHonestCounts(names: string[], groups: NameGroup[]) {
  const lowered = names.map((n) => n.normalize("NFC").toLowerCase());
  for (const g of flat(groups)) {
    const q = g.text.normalize("NFC").toLowerCase();
    const real = lowered.filter((n) => n.includes(q)).length;
    expect(real, g.text).toBe(g.count);
  }
}

/**
 * True when `text` occurs in some name on word boundaries: a non-letter (or the
 * edge of the name) on both sides, or a camelCase step (`Horrible|Subs`).
 */
function wordAligned(names: string[], text: string): boolean {
  const q = text.toLowerCase();
  const isL = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);
  const lower = (c: string | undefined) => c !== undefined && /\p{Ll}/u.test(c);
  const upper = (c: string | undefined) => c !== undefined && /\p{Lu}/u.test(c);
  return names.some((raw) => {
    const n = raw.normalize("NFC");
    const ln = n.toLowerCase();
    for (let at = ln.indexOf(q); at >= 0; at = ln.indexOf(q, at + 1)) {
      const before = n[at - 1];
      const first = n[at];
      const last = n[at + q.length - 1];
      const after = n[at + q.length];
      const leftOk = !isL(before) || (lower(before) && upper(first));
      const rightOk = !isL(after) || (lower(last) && upper(after));
      if (leftOk && rightOk) return true;
    }
    return false;
  });
}

describe("detectNameGroups", () => {
  it("suggests whole words, not the substrings around them", () => {
    const names = many(6, (i) => `holiday_${i}.mp4`);
    const texts = textsOf(names);
    expect(texts).toContain("holiday");
    for (const bad of ["holiday_", "oliday", "holida", "hol", "day"]) {
      expect(texts).not.toContain(bad);
    }
  });

  it("nests member groups under the parent (motivating Korean case)", () => {
    const names = [
      ...many(189, (i) => `에스파 영상 ${i}.mp4`),
      ...many(61, (i) => `에스파 카리나 ${i}.mp4`),
      ...many(150, (i) => `기타 클립 ${i}.mp4`),
    ];
    const groups = detectNameGroups(names, { minLength: 3 });
    const parent = groups.find((g) => g.text.includes("에스파"));
    expect(parent).toBeDefined();
    expect(parent!.count).toBe(250);
    const child = parent!.children.find((c) => c.text.includes("카리나"));
    expect(child).toBeDefined();
    expect(child!.count).toBe(61);
    // child is not also a root
    expect(groups.some((g) => g.text.includes("카리나"))).toBe(false);
    // no syllable fragments with the same file set as 에스파
    const texts = flat(groups).map((g) => g.text);
    expect(texts).not.toContain("에스");
    expect(texts).not.toContain("스파");
  });

  it("finds Korean names glued inside a longer Hangul run", () => {
    const names = [
      ...many(15, (i) => `에스파카리나직캠${i}.mp4`),
      ...many(15, (i) => `카리나브이로그${i}.mp4`),
      ...many(20, (i) => `에스파윈터무대${i}.mp4`),
      ...many(20, (i) => `random clip ${i}.mp4`),
    ];
    const groups = detectNameGroups(names);
    const texts = flat(groups).map((g) => g.text);
    expect(texts).toContain("카리나");
    expect(texts).toContain("에스파");
    expect(groups.find((g) => g.text === "카리나")?.count).toBe(30);
    expect(groups.find((g) => g.text === "에스파")?.count).toBe(35);
    expect(texts).not.toContain("에스");
    expect(texts).not.toContain("리나");
    expectHonestCounts(names, groups);
  });

  it("minCount filters", () => {
    const names = many(4, (i) => `alpha_${i}.mp4`);
    expect(detectNameGroups(names)).toEqual([]);
    expect(detectNameGroups(names, { minCount: 4 }).length).toBeGreaterThan(0);
  });

  it("scales the default minCount with folder size", () => {
    const rnd = prng(11);
    const noise = many(20000, () => `${hex(rnd, 16)}.mp4`);
    // 60 of 20,000 is below the 0.5% default; 150 is above it.
    for (let i = 0; i < 60; i++) noise[i] = `rarebird ${hex(rnd, 8)}.mp4`;
    for (let i = 60; i < 210; i++) noise[i] = `commonfowl ${hex(rnd, 8)}.mp4`;
    const texts = textsOf(noise);
    expect(texts).toContain("commonfowl");
    expect(texts).not.toContain("rarebird");
    expect(textsOf(noise, { minCount: 50 })).toContain("rarebird");
  });

  it("minLength counts code points, not UTF-16 units", () => {
    const names = many(5, (i) => `x${i}𝒜𝒜.mp4`);
    // "𝒜𝒜" is 2 letters / code points (4 UTF-16 units)
    expect(textsOf(names, { minLength: 2 })).toContain("𝒜𝒜");
    expect(textsOf(names, { minLength: 3 })).not.toContain("𝒜𝒜");
  });

  it("keeps unrelated groups that happen to share a file set", () => {
    const names = [
      ...many(5, (i) => `Paris_${i}_vacation.mp4`),
      ...many(5, (i) => `Rome_${i}_work.mp4`),
    ];
    expect(textsOf(names, { minLength: 4 })).toEqual(
      expect.arrayContaining(["Paris", "vacation", "Rome", "work"]),
    );
  });

  it("never emits 1-2 letter fragments or pieces of words for Latin text", () => {
    const names = [...sentences(800, 3), ...releases(400, 4), ...sharedSuffix(400, 5)];
    const texts = textsOf(names);
    expect(texts.length).toBeGreaterThan(5);
    for (const t of texts) {
      expect(t, t).not.toMatch(/^\p{L}{1,2}$/u);
      expect(wordAligned(names, t), t).toBe(true);
    }
    for (const frag of ["th", "er", "ing", "ight", "ght", "the", "and", "of", "with"]) {
      expect(texts).not.toContain(frag);
    }
    expect(texts).toContain("night");
  });

  it("finds phrases that contain stopwords", () => {
    const names = [
      ...many(12, (i) => `Night of the Living Dead (1968) part ${i}.mkv`),
      ...many(30, (i) => `Night at the Museum clip ${i}.mkv`),
      ...many(30, (i) => `Dawn of the Dead ${i}.mkv`),
    ];
    const groups = detectNameGroups(names);
    const texts = flat(groups).map((g) => g.text);
    const living = flat(groups).find((g) => g.text.includes("Night of the Living"));
    expect(living?.count).toBe(12);
    expect(texts).not.toContain("the");
    expect(texts).not.toContain("of the");
    expectHonestCounts(names, groups);
  });

  it("merges case variants and shows the most common casing", () => {
    const names = [
      ...many(7, (i) => `Holiday ${i}.mp4`),
      ...many(3, (i) => `holiday ${i}.mp4`),
      ...many(2, (i) => `HOLIDAY ${i}.mp4`),
      ...many(20, (i) => `work ${hex(prng(i), 6)}.mp4`),
    ];
    const g = flat(detectNameGroups(names)).filter((x) => x.text.toLowerCase() === "holiday");
    expect(g).toHaveLength(1);
    expect(g[0]!.text).toBe("Holiday");
    expect(g[0]!.count).toBe(12);
  });

  it("drops words nearly every name shares", () => {
    const names = many(100, (i) => `Season ${i % 2 ? "alpha" : "beta"} ${hex(prng(i), 8)}.mp4`);
    const texts = textsOf(names);
    expect(texts).not.toContain("Season");
    expect(texts).toEqual(expect.arrayContaining(["Season alpha", "Season beta"]));
  });

  it("keeps release tags but not lone counters", () => {
    const names = releases(300, 9);
    const texts = textsOf(names);
    expect(texts).toEqual(expect.arrayContaining(["1080p", "720p", "x264", "HEVC"]));
    // pure-digit counters are never chips; years are
    expect(texts.some((t) => /^\d+$/.test(t) && !/^(19|20)\d\d$/.test(t))).toBe(false);
    expect(texts.some((t) => /^(19|20)\d\d$/.test(t))).toBe(true);
    expectHonestCounts(names, detectNameGroups(names));
  });

  it("groups camera names by prefix and year", () => {
    const names = cameraRoll(600, 12);
    const texts = textsOf(names);
    expect(texts).toEqual(expect.arrayContaining(["IMG", "PXL", "DSC"]));
    expect(texts.some((t) => /IMG_20\d\d/.test(t))).toBe(true);
    expectHonestCounts(names, detectNameGroups(names));
  });

  it("suggests shared suffix words", () => {
    const names = sharedSuffix(400, 13);
    const texts = textsOf(names);
    expect(texts).toEqual(expect.arrayContaining(["edited", "Copy", "thumbnail"]));
  });

  it("suggests nothing for random hex names", () => {
    const rnd = prng(14);
    expect(detectNameGroups(many(3000, () => `${hex(rnd, 32)}.mp4`))).toEqual([]);
  });

  it("every emitted text matches exactly `count` names", () => {
    for (const seed of [21, 22, 23]) {
      const names = realisticMix(2000, seed);
      expectHonestCounts(names, detectNameGroups(names));
    }
  });

  it("normalises decomposed Hangul to NFC", () => {
    const nfd = "카리나".normalize("NFD");
    expect(nfd).not.toBe("카리나");
    const names = many(5, (i) => `${nfd}${i}.mp4`);
    expect(textsOf(names)).toContain("카리나");
  });

  it("maxGroups keeps the highest-count groups, deterministically", () => {
    const families = ["qqqq", "wwww", "zzzz", "xxxx"]; // disjoint alphabets
    const counts = [20, 18, 16, 14];
    const names = families.flatMap((f, k) => many(counts[k]!, (i) => `${f}_${i}.mp4`));
    const a = detectNameGroups(names, { maxGroups: 3 });
    const b = detectNameGroups([...names].reverse(), { maxGroups: 3 });
    expect(a).toEqual(b);
    expect(flat(a)).toHaveLength(3);
    expect(a.map((g) => g.text)).toEqual(["qqqq", "wwww", "zzzz"]);
    expect(a.map((g) => g.count)).toEqual([20, 18, 16]);
  });

  it("is deterministic over input order on a realistic mix", () => {
    const names = realisticMix(3000, 31);
    expect(detectNameGroups(names)).toEqual(detectNameGroups([...names].reverse()));
  });

  it("defaults to a bounded number of groups", () => {
    const rnd = prng(7);
    const vocab = many(2000, () => `w${hex(rnd, 6).replace(/\d/g, "q")}`);
    const names = many(3000, () => many(5, () => pick(rnd, vocab)).join(" "));
    expect(flat(detectNameGroups(names, { minCount: 2 })).length).toBeLessThanOrEqual(500);
  });

  it("works with Hangul code points", () => {
    const names = many(5, (i) => `카리나${i}.mp4`);
    expect(textsOf(names)).toContain("카리나");
    expect(Array.from("카리나")).toHaveLength(3);
  });

  it("ignores the extension", () => {
    const names = many(8, (i) => `clip${i}v.mp4`);
    const texts = textsOf(names);
    expect(texts.some((t) => t.includes("mp4") || t.includes("."))).toBe(false);
  });

  it("counts distinct files, not occurrences within one name", () => {
    const names = ["abab.mp4", "x.mp4"];
    expect(detectNameGroups(names, { minCount: 2 })).toEqual([]);
    const five = many(5, () => "abababab.mp4");
    const g = flat(detectNameGroups(five));
    expect(g.every((x) => x.count === 5)).toBe(true);
  });

  it("sorts by count desc, deterministically", () => {
    const names = [
      ...many(7, (i) => `aaaa${i}.mp4`),
      ...many(5, (i) => `zzzz${i}.mp4`),
      ...many(5, (i) => `bbbb${i}.mp4`),
    ];
    const a = detectNameGroups(names);
    const b = detectNameGroups([...names].reverse());
    expect(a.map((g) => [g.text, g.count])).toEqual(b.map((g) => [g.text, g.count]));
    const counts = a.map((g) => g.count);
    expect(counts).toEqual([...counts].sort((x, y) => y - x));
  });

  it("5000 realistic names run fast", () => {
    const names = realisticMix(5000, 41);
    const t0 = performance.now();
    const groups = detectNameGroups(names);
    const ms = performance.now() - t0;
    expect(groups.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });

  it("20000 realistic names run fast", () => {
    const names = realisticMix(20000, 42);
    const t0 = performance.now();
    const groups = detectNameGroups(names);
    const ms = performance.now() - t0;
    expect(groups.length).toBeGreaterThan(0);
    // the guard leaves headroom for the parallel full-suite run
    expect(ms).toBeLessThan(4000);
  });

  it("20000 shared-vocabulary names run fast", () => {
    const rnd = prng(1);
    const vocab = many(300, () => `${pick(rnd, WORDS)}${pick(rnd, ["", "s", "ing", "er"])}`);
    const names = many(20000, () => `${many(6, () => pick(rnd, vocab)).join(" ")}.mp4`);
    const t0 = performance.now();
    const groups = detectNameGroups(names);
    const ms = performance.now() - t0;
    expect(groups.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(4000);
  });

  it("20000 random hex names run fast", () => {
    const rnd = prng(2);
    const names = many(20000, () => `${hex(rnd, 32)}.mp4`);
    const t0 = performance.now();
    const groups = detectNameGroups(names);
    const ms = performance.now() - t0;
    expect(flat(groups).length).toBeLessThanOrEqual(500);
    expect(ms).toBeLessThan(4000);
  });

  it("20000 long Hangul names run fast", () => {
    const rnd = prng(3);
    const names = many(
      20000,
      (i) => `${many(4, () => pick(rnd, KO) + pick(rnd, KO_KIND)).join("")}${i}.mp4`,
    );
    const t0 = performance.now();
    const groups = detectNameGroups(names);
    const ms = performance.now() - t0;
    expect(groups.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(4000);
  });
});

describe("filterGroups", () => {
  const groups: NameGroup[] = [
    { text: "Alpha", count: 9, children: [{ text: "alpha beta", count: 5, children: [] }] },
    { text: "gamma", count: 6, children: [] },
  ];
  it("returns all for empty input", () => {
    expect(filterGroups(groups, "")).toEqual(groups);
  });
  it("narrows by case-insensitive contains, keeping matching children", () => {
    expect(filterGroups(groups, "GAM").map((g) => g.text)).toEqual(["gamma"]);
  });
  it("keeps a parent whose child matches, with only matching children", () => {
    const r = filterGroups(groups, "beta");
    expect(r.map((g) => g.text)).toEqual(["Alpha"]);
    expect(r[0]!.children.map((c) => c.text)).toEqual(["alpha beta"]);
  });
  it("matches composed and decomposed Hangul alike", () => {
    const g: NameGroup[] = [{ text: "카리나", count: 5, children: [] }];
    expect(filterGroups(g, "카리나".normalize("NFD")).map((x) => x.text)).toEqual(["카리나"]);
  });
  it("returns nothing when nothing matches", () => {
    expect(filterGroups(groups, "zzz")).toEqual([]);
  });
});
