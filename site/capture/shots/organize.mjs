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
      await page.getByText("Embedded tags.", { exact: true }).waitFor();
      await page.waitForTimeout(1200);
    },
    settleMs: 800,
    crop: { rect: { x: 240, y: 0, width: 1200, height: 900 } },
  },
  {
    id: "tools/organize/tag-edit",
    kind: "still",
    route: "/organize?path=%2Fmedia%2Forganize-sandbox%2FInbox",
    alt: "Organize with three voice memos selected and the tags panel open, showing a new title and description typed in and marked as edited.",
    waitFor: [/common names/i, /Holiday 2023/],
    setup: async (page) => {
      await openThreeMemos(page);
      await stageTitleAndDescription(page);
      await page.waitForTimeout(800);
    },
    settleMs: 800,
    crop: { rect: { x: 240, y: 0, width: 1200, height: 900 } },
  },
  {
    id: "tools/organize/tag-review",
    kind: "still",
    route: "/organize?path=%2Fmedia%2Forganize-sandbox%2FInbox",
    alt: "The review step of the tags panel, listing each voice memo with its old and new title and description, how it will be written and an Apply button.",
    waitFor: [/common names/i, /Holiday 2023/],
    setup: async (page) => {
      await openThreeMemos(page);
      await stageTitleAndDescription(page);
      await page.getByRole("button", { name: /Review changes/ }).click();
      // The review re-reads every file first, then lists the changes.
      await page.getByRole("button", { name: /Apply \d+ change/ }).waitFor();
      await page.waitForTimeout(800);
    },
    settleMs: 800,
    crop: { rect: { x: 240, y: 0, width: 1200, height: 900 } },
  },
];

/** List view, the three first voice memos selected, the tags panel open on them. */
async function openThreeMemos(page) {
  await page.evaluate(() => {
    localStorage.removeItem("parallax-organize-tag-columns");
    localStorage.setItem("parallax-organize-panel", "1");
  });
  await page.reload();
  await page.getByTestId("view-list").click();
  // The list is virtualised against the page scroll: bring the music files into view.
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(800);
  for (const n of ["001", "002", "003"]) {
    await page.getByText(`Voice Memo ${n}.mp3`).first().click();
  }
  await page.getByRole("heading", { name: "3 files", exact: true }).waitFor();
  await page.waitForTimeout(800);
}

/** Types a title and a description for all three, as staged edits (nothing is written). */
async function stageTitleAndDescription(page) {
  const title = page.getByLabel("Title", { exact: true });
  await title.waitFor();
  await page.waitForFunction(() => !document.querySelector("input[id]:disabled"));
  await title.fill("Garden recording");
  await title.press("Enter");
  const description = page.getByLabel("Description", { exact: true });
  await description.fill("Recorded in the garden, spring 2023.");
  await description.blur();
  await page
    .getByText(/Edited/)
    .first()
    .waitFor();
}
