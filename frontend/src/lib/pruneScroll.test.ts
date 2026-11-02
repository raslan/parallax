import { describe, it, expect } from "vitest";
import { clauseSignature, viewSignature } from "./pruneScroll";
import type { Clause } from "@/hooks/useQueryBuilder";

const clause = (over: Partial<Clause> = {}): Clause => ({
  id: "c1",
  fieldKey: "name",
  operator: "contains",
  value: { text: "a" },
  joinToNext: "AND",
  ...over,
});

describe("clauseSignature", () => {
  it("is stable across clause ids and identities", () => {
    expect(clauseSignature([clause()])).toBe(clauseSignature([clause({ id: "other" })]));
  });
  it("changes when a value, operator, field or joiner changes", () => {
    const base = clauseSignature([clause()]);
    expect(clauseSignature([clause({ value: { text: "b" } })])).not.toBe(base);
    expect(clauseSignature([clause({ operator: "not_contains" })])).not.toBe(base);
    expect(clauseSignature([clause({ fieldKey: "codec" })])).not.toBe(base);
    expect(clauseSignature([clause({ joinToNext: "OR" })])).not.toBe(base);
    expect(clauseSignature([])).not.toBe(base);
  });
});

describe("viewSignature", () => {
  const sorts = [
    { key: "files", dir: "desc" as const },
    { key: "name", dir: "asc" as const },
  ];
  it("changes with the filter and with any sort key or direction", () => {
    const base = viewSignature([clause()], sorts);
    expect(viewSignature([clause({ id: "x" })], sorts)).toBe(base);
    expect(viewSignature([], sorts)).not.toBe(base);
    expect(viewSignature([clause()], [sorts[0]!, { key: "size", dir: "asc" }])).not.toBe(base);
    expect(viewSignature([clause()], [{ key: "files", dir: "asc" }, sorts[1]!])).not.toBe(base);
  });
});
