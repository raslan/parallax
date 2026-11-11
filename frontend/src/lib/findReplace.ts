/**
 * "Find X, replace with Y" over a text, shared by Organize's rename and its tag editing.
 * Pure. Literal mode escapes the search text and never interprets `$` in the replacement;
 * regex mode is a global regular expression where `$1` and friends work.
 */

export interface FindRule {
  find: string;
  replace: string;
  /** `find` is a regular expression (`$1` etc. work in `replace`). */
  regex: boolean;
}

export interface CompiledRule {
  /** The regex failed to compile (a message to show), else null. */
  error: string | null;
  /** The replaced text; the text unchanged for an empty search or a bad regex. */
  apply: (text: string) => string;
}

const unchanged = (text: string) => text;

/** Compile once, apply to many texts (rename runs it over every selected name). */
export function compileFindReplace(rule: FindRule): CompiledRule {
  if (!rule.find) return { error: null, apply: unchanged };
  let re: RegExp;
  try {
    re = new RegExp(rule.regex ? rule.find : rule.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Invalid regular expression",
      apply: unchanged,
    };
  }
  return {
    error: null,
    apply: (text) =>
      rule.regex ? text.replace(re, rule.replace) : text.replace(re, () => rule.replace),
  };
}

export function applyFindReplace(
  text: string,
  rule: FindRule,
): { text: string; error: string | null } {
  const compiled = compileFindReplace(rule);
  return { text: compiled.apply(text), error: compiled.error };
}
