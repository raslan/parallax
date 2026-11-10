// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { GoneState, NoRootState, UnavailableState } from "./OrganizeStates";

afterEach(cleanup);

describe("OrganizeStates", () => {
  it("GoneState sends the user back to the top folder by replacing the entry", () => {
    render(
      <MemoryRouter initialEntries={["/organize?path=/r/gone"]}>
        <GoneState />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /Back to the top folder/ });
    expect(link.getAttribute("href")).toBe("/organize");
  });

  it("UnavailableState offers Change folder", () => {
    const onChangeFolder = vi.fn();
    render(<UnavailableState onChangeFolder={onChangeFolder} />);
    expect(screen.getByText("This folder is no longer available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Change folder/ }));
    expect(onChangeFolder).toHaveBeenCalledTimes(1);
  });

  it("NoRootState offers Choose folder", () => {
    const onChoose = vi.fn();
    render(<NoRootState onChoose={onChoose} />);
    expect(screen.getByText("Choose a folder to organize")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});
