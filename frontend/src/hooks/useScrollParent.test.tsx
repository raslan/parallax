// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useScrollParent } from "./useScrollParent";

function Probe() {
  const [scroller, ref] = useScrollParent();
  const label = scroller === null ? "none" : (scroller.dataset.id ?? scroller.tagName);
  return <div ref={ref} data-testid="probe" data-scroller={label} />;
}

afterEach(cleanup);

describe("useScrollParent", () => {
  it("finds the nearest overflow-y auto ancestor", () => {
    render(
      <div data-id="outer" style={{ overflowY: "auto" }}>
        <Probe />
      </div>,
    );
    expect(screen.getByTestId("probe").dataset.scroller).toBe("outer");
  });

  it("falls back to the document scroller when nothing in between scrolls", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").dataset.scroller).toBe("HTML");
  });
});
