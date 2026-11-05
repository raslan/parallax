// Landing page captures (RAS-78). Hero still: the Files grid, the first screen Parallax ever had.
// Re-run after the app's look changes: npm run capture -- --only landing
export default [
  {
    id: "landing/hero/files-grid",
    kind: "still",
    route: "/files",
    alt: "The Parallax Files page: the top bar with the section tabs, the sidebar, and a grid of video thumbnails with codec, size and duration under each.",
    waitFor: [/Big Buck Bunny/],
    // Whole window width so it reads as the app. Ends just under the second row of cards (the third has a lone
    // card); the page fades the bottom edge out so it can run off the bottom of the first screen.
    crop: { rect: { x: 0, y: 0, width: 1440, height: 690 } },
    variants: [720, 1080],
    budgetKB: 520,
    settleMs: 1200,
  },
  {
    // Beat: Cleanup filters. Recorded at 2x with a virtual camera (zoom to the filter, then to the results).
    id: "landing/beats/cleanup",
    kind: "clip",
    hires: true,
    route: "/cleanup",
    alt: "On the Cleanup page, a duration filter is added, then a filename filter joined to it with AND. The AND/OR switch is flipped to OR and back, and the list of files narrows to the matches.",
    waitFor: [/13\s*files match/i],
    crop: { rect: { x: 240, y: 240, width: 1184, height: 630 } },
    steps: async (page, { sleep, focus }) => {
      // Where the camera looks (page px): the filter bar, its left half, the right half with the joiner, the list.
      const BAR_LEFT = { x: 256, y: 255, width: 560, height: 129 };
      const BAR_RIGHT = { x: 470, y: 255, width: 620, height: 129 };
      const LIST = { x: 256, y: 410, width: 940, height: 330 };
      const addFilter = page.getByRole("button", { name: /add filter/i });

      await sleep(800);
      await focus(BAR_LEFT);
      await sleep(500);
      await addFilter.click();
      await sleep(600);
      await page.getByRole("option", { name: "Duration" }).click(); // "is under 30 seconds"
      await sleep(1100);

      await focus(BAR_RIGHT);
      await sleep(300);
      await page.keyboard.press("Escape"); // close the first filter's editor so "Add filter" opens its menu
      await addFilter.click();
      await sleep(600);
      await page.getByRole("option", { name: "Filename" }).click();
      await sleep(500);
      await page.getByPlaceholder(/type to match/i).fill("Tears");
      await page.keyboard.press("Enter");
      await sleep(1000);
      // The AND/OR joiner is one button holding both labels; each click flips it.
      const joiner = page
        .locator("button")
        .filter({ hasText: /^\s*ANDOR\s*$/ })
        .first();
      await joiner.click(); // to OR...
      await sleep(1100);
      await joiner.click(); // ...and back to AND
      await sleep(900);

      await focus(LIST);
      await sleep(1900);
    },
    budgetKB: 1100,
    tailMs: 1300,
  },
  {
    // The same page at phone size, so phones see the app's own mobile layout, readable, instead of a shrunken desktop.
    id: "landing/hero/files-grid-mobile",
    kind: "still",
    route: "/files",
    alt: "The Parallax Files page on a phone.",
    waitFor: [/Big Buck Bunny/],
    viewport: { width: 430, height: 900 },
    crop: { rect: { x: 0, y: 0, width: 430, height: 900 } },
    budgetKB: 260,
    settleMs: 1200,
  },
];
