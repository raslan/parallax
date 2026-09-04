// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sheet, SheetTrigger, SheetContent } from "./sheet";

describe("Sheet", () => {
  it("renders content when open", () => {
    render(
      <Sheet open>
        <SheetTrigger>open</SheetTrigger>
        <SheetContent>drawer body</SheetContent>
      </Sheet>,
    );
    expect(screen.getByText("drawer body")).toBeDefined();
  });
});
