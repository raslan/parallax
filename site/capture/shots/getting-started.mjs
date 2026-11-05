// Getting started: first scan, jobs, hardware.
const openAddDialog = async (page) => {
  await page
    .getByRole("button", { name: /^add library$/i })
    .first()
    .click();
  await page.getByText("Scan after creation").waitFor();
};

export default [
  {
    id: "getting-started/first-scan/add-library",
    kind: "still",
    route: "/libraries",
    alt: "The Add Library dialog: a path field with a folder-browse button, a split-into-sub-libraries option and a scan-after-creation option.",
    waitFor: [/Libraries/],
    setup: openAddDialog,
    crop: { selectors: [".fixed.inset-0 > .relative.z-50"], pad: 2 },
  },
  {
    id: "getting-started/first-scan/folder-picker",
    kind: "still",
    route: "/libraries",
    alt: "The folder picker listing the folders mounted into the container under /media.",
    waitFor: [/Libraries/],
    setup: async (page) => {
      await openAddDialog(page);
      await page.getByTitle("Browse").click();
      await page.getByText("videos", { exact: true }).first().waitFor();
    },
    crop: { selectors: [".fixed.inset-0 > .relative.z-50"], pad: 2 },
  },
  {
    id: "getting-started/concepts/jobs",
    kind: "still",
    route: "/jobs",
    alt: "The Jobs page listing finished jobs with their status, and a Logs toggle on each.",
    waitFor: [/Jobs/],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 420 } },
  },
  {
    id: "getting-started/hardware/transcoder-tab",
    kind: "still",
    route: "/settings?tab=transcoder",
    alt: "Settings, Transcoder tab: the detected GPU is named in the concurrent-transcodes hint, with a slider for files per GPU.",
    waitFor: [/Concurrent video transcodes/],
    crop: { selectors: ["main .rounded-lg, main [class*='card']"], pad: 12 },
  },
];
