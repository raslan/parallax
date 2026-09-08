import { describe, it, expect } from "vitest";
import { naturalSort, cleanEpisodeTitle } from "./customShow";

describe("naturalSort", () => {
  it("orders embedded numbers numerically, not lexically", () => {
    const out = naturalSort(["/x/Episode 10.mp4", "/x/Episode 2.mp4", "/x/Episode 1.mp4"]);
    expect(out.map((p) => p.split("/").pop())).toEqual([
      "Episode 1.mp4",
      "Episode 2.mp4",
      "Episode 10.mp4",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = ["/x/b.mp4", "/x/a.mp4"];
    naturalSort(input);
    expect(input).toEqual(["/x/b.mp4", "/x/a.mp4"]);
  });
});

describe("cleanEpisodeTitle", () => {
  it("strips a leading playlist index", () => {
    expect(cleanEpisodeTitle("/x/03 - The Big One.mp4")).toBe("The Big One");
    expect(cleanEpisodeTitle("/x/12. Some Title.mkv")).toBe("Some Title");
  });

  it("strips a trailing 11-char YouTube id, bracketed or not", () => {
    expect(cleanEpisodeTitle("/x/Painkiller Review [dQw4w9WgXcQ].webm")).toBe("Painkiller Review");
    expect(cleanEpisodeTitle("/x/Painkiller Review-dQw4w9WgXcQ.mp4")).toBe("Painkiller Review");
  });

  it("drops quality/codec tags and tidies separators", () => {
    expect(cleanEpisodeTitle("/x/Yahtzee_reviews_Doom_1080p_x265.mkv")).toBe(
      "Yahtzee reviews Doom",
    );
  });

  it("falls back to the bare stem when cleanup empties it", () => {
    expect(cleanEpisodeTitle("/x/dQw4w9WgXcQ.mp4")).toBe("dQw4w9WgXcQ");
  });
});
