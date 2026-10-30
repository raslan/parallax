import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("lets a custom micro size override a default size", () => {
    expect(cn("text-xs", "text-3xs")).toBe("text-3xs");
    expect(cn("text-3xs", "text-sm")).toBe("text-sm");
  });

  it("lets a later utility override an earlier one in the same group", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("keeps a micro size alongside a text colour", () => {
    expect(cn("text-2xs", "text-muted-foreground")).toBe("text-2xs text-muted-foreground");
  });
});
