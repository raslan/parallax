// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TranslateDialog } from "./TranslateDialog";

afterEach(cleanup);

const SOURCES = [
  { path: "/m/M.en.srt", filename: "M.en.srt", machine_made: false, hearing_impaired: false },
  { path: "/m/M.en.mt.srt", filename: "M.en.mt.srt", machine_made: true, hearing_impaired: false },
];
const LANGS = [
  { code: "ar", name: "Arabic" },
  { code: "de", name: "German" },
];

function setup(over: Partial<Parameters<typeof TranslateDialog>[0]> = {}) {
  const onTranslate = vi.fn();
  render(
    <TranslateDialog
      videoName="M.mkv"
      sources={SOURCES}
      languages={LANGS}
      busy={false}
      onTranslate={onTranslate}
      onClose={() => {}}
      {...over}
    />,
  );
  return onTranslate;
}

describe("TranslateDialog", () => {
  it("lists every English file, machine-made ones included and marked", () => {
    setup();
    expect(screen.getByRole("button", { name: /M\.en\.srt/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /M\.en\.mt\.srt/ }).textContent).toContain(
      "machine-made",
    );
  });

  it("translates the file and language the user picked", () => {
    const onTranslate = setup();
    fireEvent.click(screen.getByRole("button", { name: /M\.en\.mt\.srt/ }));
    fireEvent.click(screen.getByRole("button", { name: "German" }));
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(onTranslate).toHaveBeenCalledWith("/m/M.en.mt.srt", "de");
  });

  it("starts on the first file and language, which is only where the choice starts", () => {
    const onTranslate = setup();
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(onTranslate).toHaveBeenCalledWith("/m/M.en.srt", "ar");
  });

  it("says why nothing can be translated when there is no English file", () => {
    setup({ sources: [] });
    expect(screen.getByText(/no English subtitle file/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Translate" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows the server's refusal", () => {
    setup({ error: "M.en.srt is not an English subtitle of M.mkv" });
    expect(screen.getByRole("alert").textContent).toContain("not an English subtitle");
  });
});
