import { describe, expect, it } from "vitest";
import { contentReviewFields } from "./contentReviewFields";
import type { ImageFile } from "@/types/image";

const filename = contentReviewFields.find((f) => f.key === "filename");

const row = (name: string) => ({ filename: name, detections: [] }) as unknown as ImageFile;
const test = (name: string, operator: string, text: string) =>
  filename!.test!(row(name), operator as never, { text });

describe("Content Review filename filter", () => {
  it("is offered, with the same operators as Cleanup", () => {
    expect(filename).toBeDefined();
    expect(filename!.operators).toEqual(["contains", "not_contains", "fuzzy_contains"]);
    expect(filename!.defaultOperator).toBe("contains");
  });

  it("contains finds the upscaled copies, case-insensitively", () => {
    expect(test("holiday_2x.jpg", "contains", "_2x")).toBe(true);
    expect(test("HOLIDAY_2X.JPG", "contains", "_2x")).toBe(true);
    expect(test("holiday.jpg", "contains", "_2x")).toBe(false);
  });

  it("doesn't contain is the exact complement", () => {
    expect(test("holiday_2x.jpg", "not_contains", "_2x")).toBe(false);
    expect(test("holiday.jpg", "not_contains", "_2x")).toBe(true);
  });

  it("an empty query matches everything", () => {
    expect(test("anything.png", "contains", "  ")).toBe(true);
    expect(test("anything.png", "not_contains", "")).toBe(true);
  });
});
