// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LengthInfo, ScanFile } from "@/types/subtitle";
import { SubtitleBadges } from "./SubtitleBadges";

afterEach(cleanup);

const file = { path: "/m/a.mkv", subtitles: [] } as unknown as ScanFile;

describe("SubtitleBadges", () => {
  it("marks a short subtitle with one short word that names itself in full", () => {
    const length = { subtitles: [{ length: "short" }] } as unknown as LengthInfo;
    render(
      <TooltipProvider>
        <SubtitleBadges file={file} wanted={["en"]} length={length} />
      </TooltipProvider>,
    );
    // One word so a 240 px card never clips it to "looks".
    expect(screen.getByLabelText("Looks short for this video").textContent).toBe("short");
  });
});
