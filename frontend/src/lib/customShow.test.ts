import { describe, it, expect } from "vitest";
import { orderFiles, episodeIndexOf, cleanEpisodeTitle } from "./customShow";

const names = (paths: string[]) => paths.map((p) => p.split("/").pop());

describe("orderFiles", () => {
  it("orders embedded numbers numerically when nothing else applies", () => {
    const out = orderFiles(["/x/Episode 10.mp4", "/x/Episode 2.mp4", "/x/Episode 1.mp4"]);
    expect(names(out)).toEqual(["Episode 1.mp4", "Episode 2.mp4", "Episode 10.mp4"]);
  });

  it("sorts by a trailing 'Part N' marker, not the leading title text", () => {
    const out = orderFiles([
      "/x/IT KEEPS GETTING BETTER | Subnautica 2 - Part 2.mkv",
      "/x/IT'S BEAUTIFUL | Subnautica 2 - Part 1.mkv",
      "/x/THIS IS TERRIFYING | Subnautica 2 - Part 4.mkv",
      "/x/TIME TO EXPLORE | Subnautica 2 - Part 3.mkv",
    ]);
    expect(names(out)).toEqual([
      "IT'S BEAUTIFUL | Subnautica 2 - Part 1.mkv",
      "IT KEEPS GETTING BETTER | Subnautica 2 - Part 2.mkv",
      "TIME TO EXPLORE | Subnautica 2 - Part 3.mkv",
      "THIS IS TERRIFYING | Subnautica 2 - Part 4.mkv",
    ]);
  });

  it("falls back to natural filename sort when few files carry a number", () => {
    const out = orderFiles(["/x/zebra.mp4", "/x/apple.mp4", "/x/Part 3 of something.mp4"]);
    expect(names(out)).toEqual(["apple.mp4", "Part 3 of something.mp4", "zebra.mp4"]);
  });

  it("does not mutate the input array", () => {
    const input = ["/x/b.mp4", "/x/a.mp4"];
    orderFiles(input);
    expect(input).toEqual(["/x/b.mp4", "/x/a.mp4"]);
  });
});

describe("episodeIndexOf", () => {
  it("reads a trailing marker", () => {
    expect(episodeIndexOf("/x/Whatever | Show - Part 7.mkv")).toBe(7);
    expect(episodeIndexOf("/x/Whatever - Episode 12.mp4")).toBe(12);
    expect(episodeIndexOf("/x/Whatever E03.mkv")).toBe(3);
  });
  it("reads a leading index", () => {
    expect(episodeIndexOf("/x/04 - Whatever.mp4")).toBe(4);
  });
  it("returns null when there is no number", () => {
    expect(episodeIndexOf("/x/Just A Title.mp4")).toBeNull();
  });
});

describe("cleanEpisodeTitle", () => {
  it("takes the part before ' | ' and drops the trailing episode marker", () => {
    expect(cleanEpisodeTitle("/x/IT'S BEAUTIFUL | Subnautica 2 - Part 1.mkv")).toBe(
      "IT'S BEAUTIFUL",
    );
  });

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
