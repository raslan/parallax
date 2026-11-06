// Videos: Libraries and Files pages.
export default [
  {
    id: "features/libraries/overview",
    kind: "still",
    route: "/libraries",
    alt: "The Libraries page with one library card showing its folder, file count and when it was last scanned, plus refresh and delete buttons.",
    waitFor: [/Last scanned/],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 270 } },
  },
  {
    id: "features/files/list",
    kind: "still",
    route: "/files",
    alt: "The Files page in list view, with filename, codec, duration, bitrate, dates and size in columns.",
    waitFor: [/Big Buck Bunny/],
    setup: async (page) => {
      await page.getByTitle("List view").click();
      await page.getByText("Filename").first().waitFor();
    },
    crop: { rect: { x: 240, y: 80, width: 1184, height: 455 } },
  },
  {
    id: "features/duplicates/results",
    kind: "still",
    route: "/duplicates",
    alt: "The Duplicates page: a row of criteria chips, a count of duplicate groups found, and the first group with its copies side by side.",
    waitFor: [/Duplicates/],
    setup: async (page) => {
      await page.getByRole("button", { name: /^extract$/i }).click();
      await page
        .getByText(/duplicate groups? found/)
        .first()
        .waitFor({ timeout: 120000 });
    },
    crop: { rect: { x: 240, y: 80, width: 1184, height: 700 } },
  },
  {
    id: "features/compress/select",
    kind: "still",
    route: "/compress",
    alt: "The Compress page with the output settings bar, a quick-select card for files that are not HEVC, and the file grid with the estimated saving on each card.",
    waitFor: [/Select all that are/i, /Big Buck Bunny/],
    setup: async (page) => {
      await page
        .getByText(/not HEVC/)
        .first()
        .click();
      await page
        .getByText(/12 selected|selected/i)
        .first()
        .waitFor({ timeout: 10000 })
        .catch(() => {});
    },
    crop: { rect: { x: 240, y: 80, width: 1184, height: 520 } },
  },
  {
    id: "features/compress/settings",
    kind: "still",
    route: "/compress",
    alt: "The encoding settings drawer: video format, encoding speed, quality slider, maximum resolution, and the estimated size and saving.",
    waitFor: [/Encoding settings/],
    setup: async (page) => {
      await page.getByText("Encoding settings").first().click();
      await page.getByText("Max resolution").first().waitFor();
    },
    crop: {
      selectors: ["[role=dialog], [data-state=open][class*=fixed]"],
      pad: 0,
    },
  },
  {
    id: "features/toolbox/fixes",
    kind: "still",
    route: "/toolbox",
    alt: "The Toolbox page with two fixes added, Trim and Normalize volume, shown as chips above the file grid.",
    waitFor: [/Add fix/, /Big Buck Bunny/],
    setup: async (page) => {
      await page.getByRole("button", { name: /add fix/i }).click();
      await page.getByRole("button", { name: "Trim", exact: true }).click();
      await page.keyboard.press("Escape"); // the menu stays open after picking
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: /add fix/i }).click();
      await page.getByRole("button", { name: "Normalize volume" }).click();
      await page.keyboard.press("Escape");
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(5, 5);
    },
    crop: { rect: { x: 240, y: 80, width: 1184, height: 520 } },
  },
  {
    id: "features/splice/merge",
    kind: "still",
    route: "/splice",
    alt: "The merge drawer listing three videos in order, a notice that they can be joined without re-encoding, an output name and a one-chapter-per-file switch.",
    waitFor: [/Join videos into one new file/i, /Tears of Steel/],
    setup: async (page) => {
      await page.getByPlaceholder("Search files…").fill("Part");
      await page.getByRole("button", { name: "All", exact: true }).click();
      await page.getByRole("button", { name: /^merge$/i }).click();
      await page
        .getByText(/Stream copy/)
        .first()
        .waitFor({ timeout: 15000 });
    },
    crop: { rect: { x: 960, y: 0, width: 480, height: 500 } },
  },
  {
    id: "features/originals/list",
    kind: "still",
    route: "/originals",
    alt: "The Originals page: a summary of backups and space that can be recovered, and a backed-up file with its original and current size and restore and delete buttons.",
    waitFor: [/Backups/],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 380 } },
  },
];
