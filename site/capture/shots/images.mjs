export default [
  {
    id: "images/content-review/label-filter",
    kind: "still",
    route: "/content-review",
    alt: "Content Review with a detection-label filter: matching images appear in a grid with their detection labels, thumbnails blurred.",
    waitFor: [/Compose a query from detection labels/i],
    setup: async (page) => {
      await page.getByRole("button", { name: /add filter/i }).click();
      // The label list is long and scrolls; narrow it by typing so the option is on screen.
      await page.keyboard.type("FEET_COVERED");
      await page.getByRole("option", { name: "FEET_COVERED" }).click();
      // The page backgrounds a detection pass for unscanned images; wait for the result count.
      await page
        .getByText(/\d+ results/)
        .first()
        .waitFor({ timeout: 60000 });
    },
    // Thumbnails are blurred as a rule for this page, whatever the demo images contain.
    blur: ["main .grid img"],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 410 } },
  },
];
