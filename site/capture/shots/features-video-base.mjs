export default [
  {
    id: "features/files/grid",
    kind: "still",
    route: "/files",
    alt: "The Files page showing a library as a grid of video thumbnails with codec, size and bitrate under each.",
    waitFor: [/Big Buck Bunny/],
    // Height stops after row 2; 590 let a sliver of the third row's top edge show.
    crop: { rect: { x: 240, y: 80, width: 1184, height: 580 } },
    budgetKB: 220,
  },
  {
    id: "features/cleanup/duration-filter",
    kind: "clip",
    route: "/cleanup",
    alt: "Adding a duration filter on the Cleanup page narrows thirteen files down to the short ones.",
    waitFor: [/13\s*files match/i],
    crop: { rect: { x: 240, y: 240, width: 1184, height: 630 } },
    steps: async (page, { sleep }) => {
      await sleep(600);
      await page.getByRole("button", { name: /add filter/i }).click();
      await sleep(700);
      await page.getByRole("option", { name: "Duration" }).click(); // defaults to "is under 30 seconds"
      await sleep(1600);
      const input = page.locator('input[type="number"]').first();
      await input.click({ clickCount: 3 });
      await page.keyboard.type("12", { delay: 180 });
      await sleep(1400);
    },
    tailMs: 900,
  },
];
