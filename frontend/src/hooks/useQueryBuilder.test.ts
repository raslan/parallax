import { describe, it, expect } from "vitest";
import { evaluateClauses, type Clause, type FieldDef } from "./useQueryBuilder";

type Row = { id: number; n: number; name: string };

const numericField: FieldDef<Row> = {
  key: "n",
  label: "N",
  category: "numeric",
  valueType: "number",
  operators: ["gt", "lt"],
  defaultOperator: "gt",
  defaultValue: 0,
  test: (row, operator, value) =>
    operator === "gt" ? row.n > (value as number) : row.n < (value as number),
};

const nameField: FieldDef<Row> = {
  key: "name",
  label: "Name",
  category: "search",
  valueType: "text",
  operators: ["contains", "not_contains"],
  defaultOperator: "contains",
  defaultValue: "",
  test: (row, operator, value) => {
    const matches = row.name.toLowerCase().includes(String(value).toLowerCase());
    return operator === "not_contains" ? !matches : matches;
  },
};

const scoreField: FieldDef<Row> = {
  key: "score",
  label: "Score",
  category: "search",
  valueType: "percent",
  operators: ["gte", "lt"],
  defaultOperator: "gte",
  defaultValue: 50,
  getRowId: (row) => row.id,
};

const fields = { n: numericField, name: nameField, score: scoreField };

function clause(partial: Partial<Clause> & Pick<Clause, "fieldKey">): Clause {
  return {
    id: partial.fieldKey,
    operator: fields[partial.fieldKey as keyof typeof fields].defaultOperator,
    value: fields[partial.fieldKey as keyof typeof fields].defaultValue,
    joinToNext: "AND",
    ...partial,
  };
}

const row: Row = { id: 1, n: 10, name: "hello world" };

describe("evaluateClauses", () => {
  it("returns true for an empty clause list", () => {
    expect(evaluateClauses([], row, fields, {})).toBe(true);
  });

  it("evaluates a single clause", () => {
    const c = clause({ fieldKey: "n", operator: "gt", value: 5 });
    expect(evaluateClauses([c], row, fields, {})).toBe(true);
    const c2 = clause({ fieldKey: "n", operator: "gt", value: 50 });
    expect(evaluateClauses([c2], row, fields, {})).toBe(false);
  });

  it("ANDs two clauses", () => {
    const clauses = [
      clause({ fieldKey: "n", operator: "gt", value: 5, joinToNext: "AND" }),
      clause({ id: "name2", fieldKey: "name", operator: "contains", value: "hello" }),
    ];
    expect(evaluateClauses(clauses, row, fields, {})).toBe(true);

    const clausesFail = [
      clause({ fieldKey: "n", operator: "gt", value: 500, joinToNext: "AND" }),
      clause({ id: "name2", fieldKey: "name", operator: "contains", value: "hello" }),
    ];
    expect(evaluateClauses(clausesFail, row, fields, {})).toBe(false);
  });

  it("ORs two clauses", () => {
    const clauses = [
      clause({ fieldKey: "n", operator: "gt", value: 500, joinToNext: "OR" }),
      clause({ id: "name2", fieldKey: "name", operator: "contains", value: "hello" }),
    ];
    expect(evaluateClauses(clauses, row, fields, {})).toBe(true);
  });

  it("folds mixed AND/OR left-to-right with no precedence", () => {
    // (n>500 AND name contains "nope") OR name contains "hello" => true,
    // because fold is strictly left-to-right: first two combine via AND to
    // false, then that result ORs with the third clause.
    const clauses = [
      clause({ fieldKey: "n", operator: "gt", value: 500, joinToNext: "AND" }),
      clause({ id: "name2", fieldKey: "name", operator: "contains", value: "nope", joinToNext: "OR" }),
      clause({ id: "name3", fieldKey: "name", operator: "contains", value: "hello" }),
    ];
    expect(evaluateClauses(clauses, row, fields, {})).toBe(true);
  });

  it("treats not_contains correctly", () => {
    const c = clause({ fieldKey: "name", operator: "not_contains", value: "xyz" });
    expect(evaluateClauses([c], row, fields, {})).toBe(true);
    const c2 = clause({ fieldKey: "name", operator: "not_contains", value: "hello" });
    expect(evaluateClauses([c2], row, fields, {})).toBe(false);
  });

  it("treats a clause with no value yet as always-true", () => {
    const c = clause({ fieldKey: "n", operator: "gt", value: undefined });
    expect(evaluateClauses([c], row, fields, {})).toBe(true);
    const cEmptyString = clause({ fieldKey: "name", operator: "contains", value: "" });
    expect(evaluateClauses([cEmptyString], row, fields, {})).toBe(true);
  });

  it("resolves score-map-backed fields via clause id, not field key", () => {
    const c1 = clause({ id: "s1", fieldKey: "score", operator: "gte", value: 80 });
    const c2 = clause({ id: "s2", fieldKey: "score", operator: "gte", value: 80 });
    const scoreMaps = {
      s1: new Map([[1, 90]]), // c1's search matched row 1 at 90
      s2: new Map([[1, 10]]), // c2's search (different query) matched row 1 at only 10
    };
    expect(evaluateClauses([c1], row, fields, scoreMaps)).toBe(true);
    expect(evaluateClauses([c2], row, fields, scoreMaps)).toBe(false);
  });

  it("fails open when a score-map-backed clause has no score for the row", () => {
    const c = clause({ id: "s1", fieldKey: "score", operator: "gte", value: 80 });
    expect(evaluateClauses([c], row, fields, {})).toBe(true);
    expect(evaluateClauses([c], row, fields, { s1: new Map() })).toBe(true);
  });
});
