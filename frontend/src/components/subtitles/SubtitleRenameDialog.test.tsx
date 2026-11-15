// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubtitleRenameDialog } from "./SubtitleRenameDialog";

afterEach(cleanup);

const WARNING =
  "This name does not start with the video's name, so this page will no longer list it as a subtitle for this video.";

function setup(taken: string[] = [], onSubmit = vi.fn(async () => {})) {
  render(
    <SubtitleRenameDialog
      open
      file={{ path: "/m/Movie.en.srt", name: "Movie.en.srt" }}
      videoName="Movie.mkv"
      taken={new Set(["Movie.en.srt", ...taken])}
      onSubmit={onSubmit}
      onOpenChange={vi.fn()}
    />,
  );
  return onSubmit;
}
const input = () => screen.getByLabelText("New name") as HTMLInputElement;
const rename = () => screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });

describe("SubtitleRenameDialog", () => {
  it("selects the stem and leaves the extension out of the selection", () => {
    setup();
    fireEvent.focus(input());
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe("Movie.en".length);
  });

  it("warns for a name that does not start with the video's name, and still allows it", () => {
    const onSubmit = setup();
    expect(screen.queryByText(WARNING)).toBeNull();
    type("notes.srt");
    expect(screen.getByText(WARNING)).toBeTruthy();
    expect(rename().disabled).toBe(false);
    fireEvent.click(rename());
    return waitFor(() => expect(onSubmit).toHaveBeenCalledWith("notes.srt"));
  });

  it("does not warn about the video's name for a subtitle found beside no video", () => {
    render(
      <SubtitleRenameDialog
        open
        file={{ path: "/m/Subs/2_English.srt", name: "2_English.srt" }}
        videoName={null}
        taken={new Set(["2_English.srt"])}
        onSubmit={vi.fn(async () => {})}
        onOpenChange={vi.fn()}
      />,
    );
    type("notes.srt");
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(rename().disabled).toBe(false);
  });

  it("refuses a taken name with the reason", () => {
    setup(["Movie.ar.srt"]);
    type("Movie.ar.srt");
    expect(rename().disabled).toBe(true);
    expect(screen.getByText(/already taken/i)).toBeTruthy();
  });

  it("keeps Rename off for an unchanged name and for a changed extension", () => {
    setup();
    expect(rename().disabled).toBe(true);
    type("Movie.en.txt");
    expect(rename().disabled).toBe(true);
    expect(screen.getByText(/Keep the file extension/)).toBeTruthy();
  });

  it("shows the server's refusal and stays open", async () => {
    setup(
      [],
      vi.fn(async () => Promise.reject(new Error("Server said no"))),
    );
    type("Movie.en.x.srt");
    fireEvent.click(rename());
    expect(await screen.findByText("Server said no")).toBeTruthy();
  });
});
