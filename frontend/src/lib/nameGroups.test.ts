import { describe, it, expect } from "vitest";
import { detectNameGroups, filterGroups, type NameGroup } from "./nameGroups";

const many = (n: number, make: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => make(i));

function flat(groups: NameGroup[]): NameGroup[] {
  return groups.flatMap((g) => [g, ...flat(g.children)]);
}

/** Small deterministic PRNG (mulberry32) so timing inputs are reproducible. */
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

describe("detectNameGroups", () => {
  it("collapses equal-file-set substrings into the longest", () => {
    const names = many(6, (i) => `holiday_${i}.mp4`);
    const texts = flat(detectNameGroups(names)).map((g) => g.text);
    expect(texts).toContain("holiday_");
    // shorter substrings of "holiday_" with the same file set are dropped
    expect(texts).not.toContain("holiday");
    expect(texts).not.toContain("oliday_");
    expect(texts).not.toContain("hol");
  });

  it("nests member groups under the parent", () => {
    const names = [
      ...many(189, (i) => `에스파 영상 ${i}.mp4`),
      ...many(61, (i) => `에스파 카리나 ${i}.mp4`),
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
  });

  it("minCount filters", () => {
    const names = many(4, (i) => `alpha_${i}.mp4`);
    expect(detectNameGroups(names)).toEqual([]);
    expect(detectNameGroups(names, { minCount: 4 }).length).toBeGreaterThan(0);
  });

  it("minLength counts code points, not UTF-16 units", () => {
    const names = many(5, (i) => `x${i}𝒜𝒜.mp4`);
    // "𝒜𝒜" is 2 letters / code points (4 UTF-16 units)
    expect(flat(detectNameGroups(names, { minLength: 2 })).some((g) => g.text === "𝒜𝒜")).toBe(true);
    expect(detectNameGroups(names, { minLength: 3 }).some((g) => g.text === "𝒜𝒜")).toBe(false);
  });

  it("keeps unrelated groups that happen to share a file set", () => {
    const names = [
      ...many(5, (i) => `Paris_${i}_vacation.mp4`),
      ...many(5, (i) => `Rome_${i}_work.mp4`),
    ];
    const texts = flat(detectNameGroups(names)).map((g) => g.text);
    expect(texts).toEqual(expect.arrayContaining(["Paris_", "_vacation", "Rome_", "_work"]));
  });

  it("never fabricates a joined text that is not in every member name", () => {
    // "aba" and "bab" cover the same 3 files and overlap by "ba", but only one
    // name actually contains "abab": joining them would invent a group of 3.
    const names = ["abab", "aba-bab", "aba_bab"];
    const groups = flat(detectNameGroups(names, { minCount: 3, minLength: 2 }));
    for (const g of groups) {
      const real = names.filter((n) => n.includes(g.text)).length;
      expect(real, g.text).toBe(g.count);
    }
    expect(groups.map((g) => g.text).sort()).toEqual(["aba", "bab"]);
  });

  it("does not suggest groups without a letter", () => {
    const names = [...many(5, (i) => `foo 1${i}.mp4`), ...many(5, (i) => `bar 1${i}.mp4`)];
    const texts = flat(detectNameGroups(names)).map((g) => g.text);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((t) => /\p{L}/u.test(t))).toBe(true);
    expect(texts).not.toContain(" 1");
  });

  it("normalises decomposed Hangul to NFC", () => {
    const nfd = "카리나".normalize("NFD");
    expect(nfd).not.toBe("카리나");
    const names = many(5, (i) => `${nfd}${i}.mp4`);
    const texts = flat(detectNameGroups(names)).map((g) => g.text);
    expect(texts).toContain("카리나");
  });

  it("maxGroups keeps the highest-count groups, deterministically", () => {
    const families = ["qqqq", "wwww", "zzzz", "xxxx"]; // disjoint alphabets
    const counts = [20, 18, 16, 14];
    const names = families.flatMap((f, k) => many(counts[k]!, (i) => `${f}_${i}.mp4`));
    const a = detectNameGroups(names, { maxGroups: 3 });
    const b = detectNameGroups([...names].reverse(), { maxGroups: 3 });
    expect(a).toEqual(b);
    expect(flat(a)).toHaveLength(3);
    expect(a.map((g) => g.text)).toEqual(["qqqq_", "wwww_", "zzzz_"]);
    expect(a.map((g) => g.count)).toEqual([20, 18, 16]);
  });

  it("defaults to a bounded number of groups", () => {
    const rnd = prng(7);
    const names = many(3000, () => hex(rnd, 24));
    expect(flat(detectNameGroups(names)).length).toBeLessThanOrEqual(500);
  });

  it("works with Hangul code points", () => {
    const names = many(5, (i) => `카리나${i}.mp4`);
    const groups = flat(detectNameGroups(names));
    expect(groups.some((g) => g.text === "카리나")).toBe(true);
    expect(Array.from("카리나")).toHaveLength(3);
  });

  it("ignores the extension", () => {
    const names = many(8, (i) => `u${i}v.mp4`);
    const texts = flat(detectNameGroups(names)).map((g) => g.text);
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

  it("5000 names run fast", () => {
    const words = ["alpha", "beta", "gamma", "delta", "omega", "sigma", "kappa", "theta"];
    const names = many(5000, (i) => {
      const w = words[i % words.length]!;
      const w2 = words[(i * 7 + 3) % words.length]!;
      return `${w}_${w2}_episode_${String(i).padStart(5, "0")}_some_longer_filler_text_here_${i * 31}.mp4`;
    });
    const t0 = performance.now();
    const groups = detectNameGroups(names);
    const ms = performance.now() - t0;
    expect(groups.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });

  it("20000 shared-vocabulary names run fast", () => {
    const rnd = prng(1);
    const vocab = Array.from({ length: 300 }, () => hex(rnd, 3 + Math.floor(rnd() * 6)));
    const names = many(20000, () => {
      const parts = Array.from({ length: 6 }, () => vocab[Math.floor(rnd() * vocab.length)]!);
      return `${parts.join(" ")}.mp4`;
    });
    const t0 = performance.now();
    const groups = detectNameGroups(names);
    const ms = performance.now() - t0;
    expect(groups.length).toBeGreaterThan(0);
    // ~0.8 s alone; the guard leaves headroom for the parallel full-suite run.
    expect(ms).toBeLessThan(4000);
  });

  it("20000 random hex names run fast", () => {
    const rnd = prng(2);
    const names = many(20000, () => `${hex(rnd, 32)}.mp4`);
    const t0 = performance.now();
    const groups = detectNameGroups(names);
    const ms = performance.now() - t0;
    expect(flat(groups).length).toBeLessThanOrEqual(500);
    expect(ms).toBeLessThan(4000); // ~0.6 s alone
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
