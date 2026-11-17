// Subtitles: the search job, automatic save, Last search, Remove subtitles. All of it is driven
// through the real page against the demo's generated show folders (`seed.py` writes them into
// /media/shows). Order matters: the shots that only read come first, the automatic save (which
// writes subtitles beside the demo videos) last, then Remove subtitles, which needs them.
//
// The sources are asked for real, so a first run needs the demo's network. A search is cached
// for ten minutes inside the container, so film these right after the demo (re)starts.

const SHOWS = "/media/shows";
const route = (folder) => `/subtitles?path=${encodeURIComponent(folder)}`;
const ST = `${SHOWS}/Stranger Things (2016)`;
const FRIENDS = `${SHOWS}/Friends (1994)`;
const UNSORTED = `${SHOWS}/Unsorted`;

/** Only English and Arabic: fewer rows, a quicker search. */
const twoLanguages = async (page) => {
  const french = page.getByRole("button", { name: "Stop showing French" });
  if (await french.count()) await french.click();
};

/** From a title's own file list: select every file and open Find subtitles on the Titles step. */
const openTitle = async (page) => {
  // A folder with one title opens it straight away; with several, click its card.
  const card = page.getByRole("button", { name: /^Open / }).first();
  if (await card.isVisible().catch(() => false)) await card.click();
  await page
    .getByRole("button", { name: "Select all", exact: true })
    .first()
    .waitFor({ timeout: 15000 });
};

const openTitlesStep = async (page) => {
  await openTitle(page);
  await page.getByRole("button", { name: "Select all", exact: true }).first().click();
  await page.getByRole("button", { name: "Find subtitles…" }).click();
  await page.getByText("Check lengths").first().waitFor({ timeout: 15000 });
};

/** Waits for a finished search of the open folder and opens its matches from Last search. */
const openLastSearch = async (page) => {
  await page
    .getByRole("region", { name: "Last search" })
    .getByRole("button", { name: "Show the matches" })
    .click({ timeout: 240000 });
  await page.getByRole("button", { name: /Approve all clean rows/ }).waitFor({ timeout: 20000 });
};

const WIDE = { x: 240, y: 80, width: 1184, height: 760 };

export default [
  {
    id: "tools/subtitles/season-filter",
    kind: "still",
    route: route(ST),
    alt: "A show's files on the Subtitles page with the Season menu open, listing Season 1 and Season 2, and Select all and Select none beside it.",
    waitFor: [/Wanted/],
    setup: async (page) => {
      await openTitle(page);
      await page.getByRole("combobox", { name: "Season" }).click();
      await page.getByRole("option", { name: "Season 2" }).waitFor({ timeout: 10000 });
    },
    crop: { rect: { x: 240, y: 500, width: 1184, height: 300 } },
  },
  {
    id: "tools/subtitles/titles-step",
    kind: "still",
    route: route(FRIENDS),
    alt: "The Titles step of Find subtitles: the title Parallax will search for, the Check lengths tickbox, the choice between reviewing each match and saving the sure matches automatically, the run options that choice adds, and the search button.",
    waitFor: [/Wanted/],
    setup: async (page) => {
      await twoLanguages(page);
      await openTitlesStep(page);
      await page.getByRole("button", { name: "Save the sure matches automatically" }).click();
      await page.getByRole("button", { name: /Search and save for/ }).waitFor();
    },
    crop: { rect: WIDE },
  },
  {
    id: "tools/subtitles/matches-searching",
    kind: "still",
    route: route(ST),
    alt: "The Matches step while the server is still searching: a bar shows the searches done so far with a Cancel button and a note that the search runs on the server and the page can be left, above the rows found so far.",
    waitFor: [/Wanted/],
    setup: async (page) => {
      await twoLanguages(page);
      await openTitlesStep(page);
      await page.getByRole("button", { name: /^Search subtitles for/ }).click();
      await page.getByText("Searching the sources").first().waitFor({ timeout: 20000 });
    },
    settleMs: 300,
    crop: { rect: { ...WIDE, height: 730 } },
  },
  {
    id: "tools/subtitles/matches",
    kind: "still",
    route: route(ST),
    alt: "The Matches step after the search: a row per episode and a column per wanted language, each cell with the best release, its source and how its length fits the video, and a tickbox to download it.",
    waitFor: [/Wanted/],
    setup: async (page) => {
      await openLastSearch(page);
      await page.getByText("length ✓").first().waitFor({ timeout: 20000 });
    },
    crop: { rect: WIDE },
  },
  {
    id: "tools/subtitles/compare",
    kind: "still",
    route: route(ST),
    alt: "The Compare sheet beside the matches: the video, the list of candidate releases, and the subtitle's lines with the verdict buttons below; in the matches a release that covers a whole season carries a season pack tag.",
    waitFor: [/Wanted/],
    setup: async (page) => {
      await openLastSearch(page);
      await page.getByRole("button", { name: /Compare candidates for S01E01 English/ }).click();
      await page.getByText("season pack").first().waitFor({ timeout: 30000 });
      await page
        .getByText("Loading this subtitle")
        .waitFor({ state: "detached", timeout: 30000 })
        .catch(() => {});
      await page.getByText("season pack").first().scrollIntoViewIfNeeded();
    },
    crop: { rect: { x: 0, y: 56, width: 1440, height: 844 } },
  },
  {
    id: "tools/subtitles/last-search",
    kind: "still",
    route: route(ST),
    alt: "The Subtitles page for a show with a Last search line above it: when the search ended, how it went, and Show the matches.",
    waitFor: [/Wanted/],
    setup: async (page) => {
      await page.getByRole("region", { name: "Last search" }).waitFor({ timeout: 240000 });
    },
    crop: { selectors: ["[aria-label='Last search']"], pad: 28 },
  },
  {
    id: "tools/subtitles/activity",
    kind: "still",
    route: route(UNSORTED),
    alt: "The Activity section of the Subtitles page showing a running subtitle search with its progress and the file it is on, and the Show the matches and Cancel buttons.",
    waitFor: [/Wanted/],
    setup: async (page) => {
      // Start a search the way the page would, then let the page notice it.
      await twoLanguages(page);
      await openTitlesStep(page);
      await page.getByRole("button", { name: /^Search subtitles for/ }).click();
      await page.getByText("Searching the sources").first().waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: "Back to folder" }).click();
      await page
        .getByRole("button", { name: "Show the matches" })
        .first()
        .waitFor({ timeout: 20000 });
    },
    crop: { selectors: ["[aria-label='Activity']"], pad: 28 },
  },
  {
    id: "tools/subtitles/left-for-you",
    kind: "still",
    route: route(SHOWS),
    alt: "The Matches step after a search that saved the sure matches automatically: saved rows are marked, and a Left for you summary counts the rows it left with their reasons, with a Review button.",
    waitFor: [/Wanted/],
    setup: async (page) => {
      await twoLanguages(page);
      await page.getByRole("button", { name: "Select all", exact: true }).first().click();
      await page.getByRole("button", { name: "Find subtitles…" }).click();
      await page.getByText("Check lengths").first().waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Save the sure matches automatically" }).click();
      await page.getByRole("button", { name: /Search and save for 3 titles/ }).click();
      await page.getByRole("region", { name: "Left for you" }).waitFor({ timeout: 600000 });
      // Done when the progress bar is gone.
      await page.getByText("Searching the sources").waitFor({ state: "detached", timeout: 600000 });
      await page
        .getByText("Checking subtitle lengths")
        .waitFor({ state: "detached", timeout: 600000 });
    },
    crop: { rect: { ...WIDE, height: 690 } },
  },
  {
    id: "tools/subtitles/remove",
    kind: "still",
    route: route(SHOWS),
    alt: "The Remove subtitles dialog: a table of languages against kinds (real, hearing impaired, generated, translated, sync backups) with the number of files in each, a tickbox on every cell that has files, and a Remove button.",
    waitFor: [/Wanted/],
    setup: async (page) => {
      await page.getByRole("button", { name: "Select all", exact: true }).first().click();
      await page.getByRole("button", { name: "Remove subtitles…" }).click();
      await page.getByRole("table").waitFor({ timeout: 20000 });
      await page.getByRole("checkbox", { name: /real$/ }).first().click();
    },
    crop: {
      selectors: ["table", /^Remove subtitles$/, /Real does not include/],
      pad: 100,
    },
  },
];
