import { describe, expect, it } from "vitest";
import { applyFindReplace, compileFindReplace } from "./findReplace";

const lit = (find: string, replace: string) => ({ find, replace, regex: false });
const rx = (find: string, replace: string) => ({ find, replace, regex: true });

describe("applyFindReplace", () => {
  it("replaces every occurrence", () => {
    expect(applyFindReplace("a-b-a", lit("a", "x"))).toEqual({ text: "x-b-x", error: null });
  });

  it("literal mode never interprets $ in the replacement", () => {
    expect(applyFindReplace("price", lit("price", "$1 $& $$")).text).toBe("$1 $& $$");
  });

  it("literal mode escapes special characters in the search text", () => {
    expect(applyFindReplace("axb a.b", lit("a.b", "Z")).text).toBe("axb Z");
    expect(applyFindReplace("(x)", lit("(x)", "y")).text).toBe("y");
  });

  it("regex mode supports capture groups in the replacement", () => {
    expect(applyFindReplace("IMG_12", rx("IMG_(\\d+)", "Pic $1")).text).toBe("Pic 12");
  });

  it("an empty search changes nothing", () => {
    expect(applyFindReplace("abc", lit("", "x"))).toEqual({ text: "abc", error: null });
    expect(applyFindReplace("abc", rx("", "x"))).toEqual({ text: "abc", error: null });
  });

  it("an invalid regex returns an error and the original text", () => {
    const out = applyFindReplace("abc", rx("(", "x"));
    expect(out.text).toBe("abc");
    expect(out.error).toBeTruthy();
  });

  it("works across lines and on text with no match", () => {
    expect(applyFindReplace("one\ntwo", lit("two", "2")).text).toBe("one\n2");
    expect(applyFindReplace("nothing here", lit("zzz", "y")).text).toBe("nothing here");
  });
});

describe("compileFindReplace", () => {
  it("compiles once and applies to many texts", () => {
    const rule = compileFindReplace(lit("-", "+"));
    expect(rule.error).toBeNull();
    expect(["a-b", "c-d-e"].map(rule.apply)).toEqual(["a+b", "c+d+e"]);
  });

  it("reports a bad regex once and then returns texts unchanged", () => {
    const rule = compileFindReplace(rx("[", ""));
    expect(rule.error).toBeTruthy();
    expect(rule.apply("abc")).toBe("abc");
  });
});
