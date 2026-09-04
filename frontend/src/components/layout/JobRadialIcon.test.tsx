// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { JobRadialIcon } from "./JobRadialIcon";

describe("JobRadialIcon", () => {
  it("renders no badge and no progressbar when idle", () => {
    const { container, queryByTestId } = render(<JobRadialIcon progress={null} count={0} />);
    expect(queryByTestId("job-badge")).toBeNull();
    expect(container.querySelector(".CircularProgressbar")).toBeNull();
  });

  it("renders the progressbar and badge when running", () => {
    const { container, getByTestId } = render(<JobRadialIcon progress={42} count={2} />);
    expect(container.querySelector(".CircularProgressbar")).not.toBeNull();
    expect(getByTestId("job-badge").textContent).toBe("2");
  });

  it("spins for the pending state", () => {
    const { getByTestId } = render(<JobRadialIcon progress="pending" count={1} />);
    expect(getByTestId("job-radial-spin")).toBeDefined();
  });
});
