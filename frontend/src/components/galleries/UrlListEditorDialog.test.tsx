// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { UrlListEditorDialog } from "./UrlListEditorDialog";

afterEach(cleanup);

function renderDialog(over: Partial<Parameters<typeof UrlListEditorDialog>[0]> = {}) {
  const props = {
    open: true,
    isNew: false,
    name: "weekly",
    onNameChange: vi.fn(),
    text: "https://a\n\n# note\nhttps://b\n",
    onTextChange: vi.fn(),
    saving: false,
    error: null,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<UrlListEditorDialog {...props} />);
  return props;
}

describe("UrlListEditorDialog", () => {
  it("counts only real URLs (blank and # lines skipped)", () => {
    renderDialog();
    expect(screen.getByText("2 URLs")).toBeTruthy();
  });

  it("offers Delete only for an existing list", () => {
    renderDialog({ isNew: false });
    expect(screen.getByText("Delete list")).toBeTruthy();
    cleanup();
    renderDialog({ isNew: true, name: "" });
    expect(screen.queryByText("Delete list")).toBeNull();
  });

  it("disables Save without a name and saves on click otherwise", () => {
    renderDialog({ name: "  " });
    expect((screen.getByText("Save").closest("button") as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const p = renderDialog();
    fireEvent.click(screen.getByText("Save"));
    expect(p.onSave).toHaveBeenCalledOnce();
  });

  it("shows a save error", () => {
    renderDialog({ error: "A list named “x” already exists" });
    expect(screen.getByText(/already exists/)).toBeTruthy();
  });
});
