import { describe, it, expect } from "vitest";
import { clauseSignature } from "./pruneScroll";
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
