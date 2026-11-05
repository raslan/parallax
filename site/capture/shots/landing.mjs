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
