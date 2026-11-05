// Features pages: the image and audio versions of shared pages.
export default [
  {
    id: "features/files/images",
    kind: "still",
    route: "/images",
    alt: "The Images page showing a library as a grid of photo thumbnails, with filters and search along the top.",
    waitFor: [/Browse and manage images/],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 560 } },
    budgetKB: 220,
  },
  {
    id: "features/files/audio",
    kind: "still",
    route: "/audio-files",
    alt: "The Audio Files page: a list of tracks with their format, duration, bitrate and size.",
    waitFor: [/Kevin MacLeod|\.mp3/],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 420 } },
  },
  {
    id: "features/duplicates/images",
    kind: "still",
    route: "/image-duplicates",
    alt: "Image duplicates: a similarity slider, a Find Duplicates button, and groups of look-alike pictures.",
    waitFor: [/Min similarity/],
    setup: async (page) => {
      await page
        .getByRole("button", { name: /find duplicates/i })
        .first()
        .click();
      await page
        .getByText(/similar|duplicate group|group/i)
        .first()
        .waitFor({ timeout: 60000 })
        .catch(() => {});
    },
    crop: { rect: { x: 240, y: 80, width: 1184, height: 560 } },
  },
  {
    id: "features/duplicates/audio",
    kind: "still",
    route: "/audio-duplicates",
    alt: "Audio duplicates: criteria chips for duration and audio fingerprint, and a group of matching tracks with one marked to keep.",
    waitFor: [/Duplicates/],
    setup: async (page) => {
      await page
        .getByRole("button", { name: /find duplicates/i })
        .first()
        .click();
      await page
        .getByText(/duplicate groups? found/)
        .first()
        .waitFor({ timeout: 120000 });
    },
    crop: { rect: { x: 240, y: 80, width: 1184, height: 640 } },
  },
  {
    id: "features/compress/audio",
    kind: "still",
    route: "/audio-compress",
    alt: "Audio compression settings: output format, a bitrate slider with a quality label, and the estimated size and saving.",
    waitFor: [/Compress/],
    setup: async (page) => {
      await page
        .getByText(/Encoding settings|settings/i)
        .first()
        .click();
      await page.getByText("Bitrate", { exact: true }).first().waitFor();
    },
    crop: { rect: { x: 832, y: 0, width: 608, height: 560 } },
  },
  {
    id: "features/originals/quarantined",
    kind: "still",
    route: "/image-quarantined",
    alt: "The Quarantined page listing images set aside, each with restore and permanent-delete buttons.",
    waitFor: [/Quarantined/],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 360 } },
  },
  {
    id: "features/image-upscale/options",
    kind: "still",
    route: "/image-upscale",
    alt: "The Upscale options: quality tiers Fast, Sharp and Natural, a resize method, and a switch to use the processor only.",
    waitFor: [/Upscale/],
    setup: async (page) => {
      await page
        .getByRole("button", { name: /fast|upscale settings|·/i })
        .first()
        .click()
        .catch(() => {});
      await page.getByText("Resize method").first().waitFor({ timeout: 10000 });
    },
    crop: { rect: { x: 832, y: 0, width: 608, height: 490 } },
  },
];
