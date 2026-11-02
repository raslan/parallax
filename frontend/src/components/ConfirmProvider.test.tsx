// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { ConfirmProvider, useConfirm, type ConfirmOptions } from "./ConfirmProvider";

afterEach(cleanup);

/** Renders the provider and hands back a `confirm` that records each answer. */
function setup() {
  let confirm!: ReturnType<typeof useConfirm>;
  function Grab() {
    confirm = useConfirm();
    return null;
  }
  render(
    <ConfirmProvider>
      <Grab />
    </ConfirmProvider>,
  );
  const ask = (opts: ConfirmOptions) => {
    let answer: boolean | undefined;
    act(() => {
      void confirm(opts).then((v) => (answer = v));
    });
    return () => answer;
  };
  return { ask };
}

describe("ConfirmProvider", () => {
  it("renders a plain confirm exactly as before: no checkbox, action enabled", async () => {
    const { ask } = setup();
    const answer = ask({ title: "Delete?", description: "Gone for good", confirmText: "Delete" });
    expect(screen.getByText("Gone for good").tagName).toBe("P");
    expect(screen.queryByRole("checkbox")).toBeNull();
    const del = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    fireEvent.click(del);
    await waitFor(() => expect(answer()).toBe(true));
  });

  it("gates the action behind the acknowledge checkbox", async () => {
    const { ask } = setup();
    const answer = ask({
      description: "Folder",
      confirmText: "Delete folder",
      acknowledge: "I'm sure",
    });
    const del = screen.getByRole("button", { name: "Delete folder" }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I'm sure" }));
    expect(del.disabled).toBe(false);
    fireEvent.click(del);
    await waitFor(() => expect(answer()).toBe(true));
  });

  it("starts unticked on every open", async () => {
    const { ask } = setup();
    const first = ask({ description: "A", confirmText: "Go", acknowledge: "I'm sure" });
    fireEvent.click(screen.getByRole("checkbox", { name: "I'm sure" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(first()).toBe(false));
    ask({ description: "B", confirmText: "Go", acknowledge: "I'm sure" });
    await waitFor(() => expect(screen.getByText("B")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("puts a rich description in a div, not a paragraph", () => {
    const { ask } = setup();
    ask({
      description: (
        <ul>
          <li>one</li>
        </ul>
      ),
    });
    expect(screen.getByRole("list").closest("p")).toBeNull();
  });
});
