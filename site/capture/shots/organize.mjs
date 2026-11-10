export default [
  {
    id: "tools/organize/name-groups",
    kind: "still",
    route: "/organize?path=%2Fmedia%2Forganize-sandbox%2FInbox",
    alt: "Organize listing an unsorted folder, with common-name chips and one-click smart selection by file type.",
    waitFor: [/common names/i, /Holiday 2023/],
    crop: { rect: { x: 240, y: 425, width: 1184, height: 290 } },
  },
  {
    id: "tools/organize/tags",
    kind: "still",
    route: "/organize?path=%2Fmedia%2Forganize-sandbox%2FInbox",
    alt: "Organize in list view with title, artist and date columns, and the tags panel open on the right with one song's title, album, genre and other tags.",
    waitFor: [/common names/i, /Holiday 2023/],
    setup: async (page) => {
      // Tag columns and the panel switch are remembered per browser; set them, then reload.
      await page.evaluate(() => {
        localStorage.setItem(
          "parallax-organize-tag-columns",
          JSON.stringify(["title", "artist", "date"]),
        );
        localStorage.setItem("parallax-organize-panel", "1");
      });
      await page.reload();
      await page.getByTestId("view-list").click();
      // The list is virtualised against the page scroll: bring the music files into view.
      await page.mouse.move(700, 500);
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(800);
      await page.getByText("Voice Memo 001.mp3").first().click();
      await page.getByText("Embedded tags, read-only.").waitFor();
      await page.waitForTimeout(1200);
    },
    settleMs: 800,
    crop: { rect: { x: 240, y: 0, width: 1200, height: 900 } },
  },
];
