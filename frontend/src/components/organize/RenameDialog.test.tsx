// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { RenameDialog } from "@/components/organize/RenameDialog";

afterEach(cleanup);

// Radix's Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const file = (name: string) => ({ path: `/r/${name}`, name });

function setup(
  items: { path: string; name: string }[],
  opts: { noun?: "file" | "folder"; taken?: string[]; onSubmit?: () => Promise<void> } = {},
) {
  const onSubmit = vi.fn(opts.onSubmit ?? (() => Promise.resolve()));
  const onOpenChange = vi.fn();
  render(
    <RenameDialog
      open
      onOpenChange={onOpenChange}
      noun={opts.noun ?? "file"}
      items={items}
      taken={new Set(opts.taken ?? items.map((i) => i.name))}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onOpenChange };
}

describe("RenameDialog", () => {
  it("renames one file to the typed name", async () => {
    const { onSubmit, onOpenChange } = setup([file("a.jpg")]);
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "b.jpg" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith([{ path: "/r/a.jpg", name: "b.jpg" }]),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("refuses a name that is already taken", () => {
    setup([file("a.jpg"), file("b.jpg")].slice(0, 1), { taken: ["a.jpg", "b.jpg"] });
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "b.jpg" } });
    expect(screen.getByText("That name is already taken")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("previews a find/replace over several files and submits only the ready ones", async () => {
    const { onSubmit } = setup([file("IMG_1.jpg"), file("IMG_2.jpg"), file("keep.jpg")]);
    fireEvent.change(screen.getByLabelText("Find"), { target: { value: "IMG_" } });
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "Trip " } });
    const preview = screen.getByLabelText("Rename preview");
    expect(preview.textContent).toContain("→ Trip 1.jpg");
    expect(preview.textContent).toContain("→ Trip 2.jpg");
    expect(preview.textContent).not.toContain("keep.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Rename 2" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith([
        { path: "/r/IMG_1.jpg", name: "Trip 1.jpg" },
        { path: "/r/IMG_2.jpg", name: "Trip 2.jpg" },
      ]),
    );
  });

  it("shows the server's message and stays open when the call fails", async () => {
    const { onOpenChange } = setup([file("a.jpg")], {
      onSubmit: () => Promise.reject(new Error("Disk on fire")),
    });
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "b.jpg" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await screen.findByText(/Disk on fire/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
