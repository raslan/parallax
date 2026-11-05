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
    // Beat: Organize. Common names found in a messy folder, one click to filter, one click to select a kind.
    id: "landing/beats/organize",
    kind: "clip",
    hires: true,
    route: "/organize?path=%2Fmedia%2Forganize-sandbox%2FInbox",
    alt: "In Organize, a messy folder shows common names found in its file names. Clicking one filters the folder to those files, then one click selects all the images, and the action bar for moving, renaming and deleting appears.",
    waitFor: [/common names/i, /Holiday 2023/],
    settleMs: 2500,
    crop: { rect: { x: 240, y: 420, width: 1184, height: 480 } },
    steps: async (page, { sleep, focus }) => {
      const chip = page.getByRole("button", { name: /Holiday 2023/ });
      await sleep(700);
      await focus(chip, { pad: { x: 320, y: 40 } });
      await sleep(900);
      await chip.click();
      await sleep(1500);
      await focus(page.getByRole("button", { name: /Select all that are images/ }), {
        pad: { x: 380, y: 30 },
      });
      await sleep(700);
      await page.getByRole("button", { name: /Select all that are images/ }).click();
      await sleep(900);
      await focus({ x: 240, y: 800, width: 1184, height: 100 }, { pad: { x: 0, y: 0 } });
      await sleep(2000);
    },
    budgetKB: 1100,
    tailMs: 1200,
  },
  {
    // Beat: Identify. Search the show, the files drop into their episodes, preview the new names.
    id: "landing/beats/identify",
    kind: "clip",
    hires: true,
    route: "/identify",
    alt: "In Identify, a folder of badly named episodes is matched to a TV show: the show is picked from the search results, every file drops into its episode slot, and the preview lists each old name next to its new, properly formatted name.",
    waitFor: [/Identify & Rename/],
    setup: async (page) => {
      // Picking the folder opens the show search with a guess already filled in; this part is not filmed.
      await page
        .getByRole("button", { name: /browse/i })
        .first()
        .click();
      for (const part of ["identify-incoming", "Pioneer.One.S01.720p.HDTV.x264-DEMO"]) {
        await page.getByText(part, { exact: true }).click();
      }
      await page.getByRole("button", { name: /^Select/ }).click();
      await page.getByText("Pioneer One", { exact: true }).first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(1200);
    },
    crop: { rect: { x: 240, y: 0, width: 1200, height: 900 } },
    steps: async (page, { sleep, focus }) => {
      await sleep(600);
      await focus({ x: 385, y: 243, width: 671, height: 415 }, { pad: { x: 20, y: 20 } });
      await sleep(1200);
      await page.getByText("Pioneer One", { exact: true }).first().click();
      await page
        .getByText(/6\/6 matched/)
        .first()
        .waitFor({ timeout: 30000 });
      await sleep(500);
      await focus({ x: 256, y: 321, width: 816, height: 520 }, { pad: { x: 0, y: 0 } });
      await sleep(2000);
      await page.getByRole("button", { name: /preview renames/i }).click();
      await page
        .getByText(/Files \(\d+\)/)
        .first()
        .waitFor({ timeout: 20000 });
      await sleep(600);
      await focus({ x: 864, y: 0, width: 576, height: 490 }, { pad: { x: 0, y: 0 } });
      await sleep(2300);
    },
    budgetKB: 1200,
    tailMs: 1200,
  },
  {
    // Beat: Duplicates. Take criteria away and the groups reshape; open one to tune it.
    id: "landing/beats/duplicates",
    kind: "clip",
    hires: true,
    route: "/duplicates",
    alt: "On the Duplicates page, the row of match criteria is edited. Removing Exact size and Duration makes a second group of look-alike videos appear, and the Visual match opens to show its similarity setting.",
    waitFor: [/Duplicates/],
    setup: async (page) => {
      // Prepare the comparison data once with only the Visual criterion on, so removing chips on camera
      // never shows the "results may be incomplete" banner. Then put the first two chips back.
      const xs = () => page.locator("button:has(svg.lucide-x)");
      await page.waitForTimeout(1500);
      while ((await xs().count()) > 1) {
        await xs().nth(0).click();
        await page.waitForTimeout(300);
      }
      await page
        .getByRole("button", { name: /^extract$/i })
        .first()
        .click();
      await page
        .getByText(/Extracting/)
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await page
        .getByText(/Extracting/)
        .first()
        .waitFor({ state: "detached", timeout: 240000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
      for (const name of ["Exact size", "Duration"]) {
        await page.getByRole("button", { name: /add criterion/i }).click();
        await page.getByText(name, { exact: true }).last().click();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(5, 5);
      await page.waitForTimeout(800);
    },
    crop: { rect: { x: 240, y: 80, width: 1184, height: 800 } },
    steps: async (page, { sleep, focus }) => {
      const BAR = { x: 256, y: 255, width: 1152, height: 67 };
      const xs = () => page.locator("button:has(svg.lucide-x)");
      await sleep(700);
      await focus(BAR, { pad: { x: 0, y: 40 } });
      await sleep(900);
      await xs().nth(0).click(); // drop Exact size
      await sleep(1100);
      await xs().nth(0).click(); // drop Duration: a second group of look-alikes appears
      await sleep(900);
      await focus({ x: 256, y: 330, width: 1152, height: 500 }, { pad: { x: 0, y: 0 } });
      await sleep(2200);
      await focus(BAR, { pad: { x: 0, y: 40 } });
      await sleep(600);
      await page.getByText("Visual (pHash)").click();
      await sleep(600);
      await focus({ x: 256, y: 255, width: 640, height: 280 }, { pad: { x: 0, y: 0 } });
      await sleep(2000);
      await page.keyboard.press("Escape");
      await sleep(400);
    },
    budgetKB: 1200,
    tailMs: 1000,
  },
  {
    // Beat: Compress. Open the settings, slide the quality, watch the estimate move.
    id: "landing/beats/compress",
    kind: "clip",
    hires: true,
    route: "/compress",
    alt: "On the Compress page, the encoding settings drawer opens and the quality slider is moved. The estimated output size and savings change as it moves.",
    waitFor: [/Encoding settings/, /Big Buck Bunny/],
    settleMs: 1500,
    crop: { rect: { x: 240, y: 0, width: 1200, height: 900 } },
    steps: async (page, { sleep, focus }) => {
      await sleep(700);
      await focus(page.getByText("Encoding settings").first(), { pad: { x: 300, y: 40 } });
      await sleep(900);
      await page.getByText("Encoding settings").first().click();
      await page.getByText("Max resolution").first().waitFor();
      await sleep(900);
      await focus({ x: 849, y: 300, width: 575, height: 150 }, { pad: { x: 0, y: 0 } });
      await sleep(600);
      const thumb = page.locator("[role=dialog] [role=slider]").first();
      await thumb.focus();
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("ArrowRight");
        await sleep(170);
      }
      await sleep(500);
      await focus({ x: 849, y: 640, width: 575, height: 210 }, { pad: { x: 0, y: 0 } });
      await sleep(900);
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press("ArrowLeft");
        await sleep(150);
      }
      await sleep(1600);
    },
    budgetKB: 1400,
    tailMs: 1200,
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
