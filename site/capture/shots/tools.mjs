// Tools: Identify.
const pickFolder = async (page, ...path) => {
  await page
    .getByRole("button", { name: /browse/i })
    .first()
    .click();
  for (const part of path) await page.getByText(part, { exact: true }).click();
  await page.getByRole("button", { name: /^Select/ }).click();
};

const matchTv = async (page) => {
  await pickFolder(page, "identify-incoming", "Pioneer.One.S01.720p.HDTV.x264-DEMO");
  await page.getByText("Pioneer One", { exact: true }).first().click();
  await page
    .getByText(/6\/6 matched/)
    .first()
    .waitFor({ timeout: 20000 });
};

export default [
  {
    id: "tools/identify/tv-match",
    kind: "still",
    route: "/identify",
    alt: "Identify with a TV show matched: each episode from the online database is listed with its number and title and the file placed in it, with an unassigned list on the right.",
    waitFor: [/Identify & Rename/],
    setup: matchTv,
    crop: { rect: { x: 240, y: 80, width: 1184, height: 760 } },
    budgetKB: 220,
  },
  {
    id: "tools/identify/preview",
    kind: "still",
    route: "/identify",
    alt: "The preview drawer listing the folder and file names before and after renaming, with an Apply renames button.",
    waitFor: [/Identify & Rename/],
    setup: async (page) => {
      await matchTv(page);
      await page.getByRole("button", { name: /preview renames/i }).click();
      await page
        .getByText(/Files \(\d+\)/)
        .first()
        .waitFor({ timeout: 20000 });
    },
    crop: { rect: { x: 864, y: 0, width: 576, height: 490 } },
  },
  {
    id: "tools/identify/custom",
    kind: "still",
    route: "/identify",
    alt: "Identify in Custom mode: a folder of videos ordered into one season by upload date, with cleaned-up titles and sort options for name, added date and upload date.",
    waitFor: [/Identify & Rename/],
    setup: async (page) => {
      // Pick the mode first: in TV mode a search dialog opens as soon as a folder is chosen.
      await page.getByRole("button", { name: "Custom", exact: true }).click();
      await pickFolder(page, "identify-incoming", "Backyard Astronomy");
      await page
        .getByText(/Generic titles/)
        .first()
        .waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: "Upload date" }).click();
      await page.waitForTimeout(2500);
    },
    crop: { rect: { x: 240, y: 80, width: 1184, height: 700 } },
    budgetKB: 220,
  },
  {
    id: "tools/subtitles/scan",
    kind: "still",
    route: "/subtitles",
    alt: "The Subtitles page after scanning a folder: language buttons, a count of files with and without subtitles, buttons to sync or download the missing ones, and each video with a badge for every language.",
    waitFor: [/Download and match subtitle files/],
    setup: async (page) => {
      await page.getByPlaceholder("/media/shows/Breaking Bad").fill("/media/videos");
      await page.keyboard.press("Enter");
      await page
        .getByText(/have subtitles/)
        .first()
        .waitFor({ timeout: 30000 });
    },
    crop: { rect: { x: 240, y: 80, width: 1184, height: 640 } },
  },
  {
    id: "tools/organize/folders",
    kind: "still",
    route: "/organize?path=%2Fmedia%2Forganize-sandbox",
    alt: "Organize showing a folder as cards, each with its file count and size, with breadcrumbs above and sort controls beside them.",
    waitFor: [/Organizing/],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 560 } },
  },
  {
    id: "tools/downloads/options",
    kind: "still",
    route: "/downloads",
    alt: "The download options panel: video or audio only, quality from Best to 360p, codec, parallel connections, trim start and end, output folder, subtitles and group by uploader.",
    waitFor: [/Options/],
    setup: async (page) => {
      // The app's hint text names a site; keep the still generic.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll("span")) {
          if (el.textContent?.includes("(YouTube)"))
            el.textContent = el.textContent.replace(/\s*\(YouTube\)/, "");
        }
      });
    },
    crop: { rect: { x: 1116, y: 88, width: 292, height: 698 } },
  },
  {
    id: "tools/galleries/options",
    kind: "still",
    route: "/galleries",
    alt: "The gallery options panel: base folder, parallel URLs, content type, maximum file size, retries, timeout, stop after existing files, and the skip already downloaded switch.",
    waitFor: [/Options/],
    crop: { rect: { x: 1116, y: 88, width: 292, height: 657 } },
  },
];
