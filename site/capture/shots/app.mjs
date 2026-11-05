// App-wide pages: Home, command palette, player, filters, themes, settings.
export default [
  {
    id: "app/home/dashboard",
    kind: "still",
    route: "/",
    alt: "The Home page: space saved so far, a chart of savings over time, work by type, quick-start tiles and a grid of recent activity.",
    waitFor: [/Start something/],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 440 } },
  },
  {
    id: "app/palette/open",
    kind: "still",
    route: "/",
    alt: "The command palette open over the page with a search for compress and the matching page highlighted.",
    waitFor: [/Start something/],
    setup: async (page) => {
      await page.keyboard.press("Control+k");
      await page.keyboard.type("comp");
      await page.waitForTimeout(600);
    },
    crop: { rect: { x: 440, y: 300, width: 560, height: 340 } },
  },
  {
    id: "app/themes/picker",
    kind: "still",
    route: "/settings",
    alt: "Settings, General tab: the colour theme picker with the five Parallax themes, then the colour and classic groups, each shown as a small preview.",
    waitFor: [/Colour theme/],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 570 } },
  },
  {
    id: "app/settings/ai-models",
    kind: "still",
    route: "/settings?tab=ai",
    alt: "Settings, AI Models tab: scan batch size and prefetch sliders, and the content detection models with their download buttons.",
    waitFor: [/Scan batch size/],
    crop: { rect: { x: 240, y: 80, width: 1184, height: 640 } },
  },
  {
    id: "app/filters/builder",
    kind: "still",
    route: "/cleanup",
    alt: "The filter builder on Cleanup with two conditions, duration and file size, joined with AND, and the count of files that match.",
    waitFor: [/Add filter/],
    setup: async (page) => {
      await page.getByRole("button", { name: /add filter/i }).click();
      await page.getByRole("option", { name: "Duration" }).click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /add filter/i }).click();
      await page.getByRole("option", { name: "File size" }).click();
      await page.keyboard.press("Escape");
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(5, 5);
      await page.waitForTimeout(600);
    },
    crop: { rect: { x: 240, y: 215, width: 1184, height: 110 } },
  },
  {
    id: "app/player/open",
    kind: "still",
    route: "/files",
    alt: "The video player open over the Files page, with the playback controls and a captions button along the bottom.",
    waitFor: [/Big Buck Bunny/],
    setup: async (page) => {
      await page.getByText("Big Buck Bunny (2008)").first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Play" }).click();
      await page.locator("video").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await page.mouse.move(720, 500); // the controls fade out until the pointer moves
      await page.waitForTimeout(300);
      await page.mouse.move(740, 520);
      await page.waitForTimeout(700);
    },
    crop: { rect: { x: 0, y: 60, width: 1440, height: 780 } },
    budgetKB: 240,
  },
];
