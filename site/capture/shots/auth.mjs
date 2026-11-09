// Sign-in pages and the Account card. These need the demo started with PARALLAX_AUTH=on, so a
// plain `npm run capture` skips them; film them with `npm run capture -- --only auth`
// (see capture/demo/docker-compose.demo.yml). The runner creates the demo account itself. The
// setup shot must come first: it needs an instance with no account yet.
export default [
  {
    id: "auth/account/setup",
    kind: "still",
    auth: "setup",
    route: "/",
    alt: "The first-run page: the Parallax logo and name above a card to create the account, with a username, a password and a confirmation field.",
    waitFor: [/Welcome to Parallax/],
    crop: { selectors: ["main > div"], pad: 40 },
  },
  {
    id: "auth/account/login",
    kind: "still",
    auth: "login",
    route: "/",
    alt: "The sign-in page: a card with a username field, a password field with a show button, and a Sign in button, with a note on how to reset a forgotten password.",
    waitFor: [/Forgot your password/],
    crop: { selectors: ["main > div"], pad: 40 },
  },
  {
    id: "auth/account/settings",
    kind: "still",
    auth: "account",
    route: "/settings",
    alt: "Settings, General tab: the Account card, where you change your username or password and can sign out everywhere.",
    waitFor: [/Sign out everywhere/],
    setup: async (page) => {
      // Bring the whole card into view, clear of the page's sticky header.
      await page.evaluate(() => {
        const title = [...document.querySelectorAll("p")].find((p) => p.textContent === "Account");
        title?.scrollIntoView({ block: "start" });
        document.getElementById("main-content")?.scrollBy(0, -140);
      });
      await page.waitForTimeout(300);
    },
    crop: {
      selectors: [/^Account$/, "form[aria-label='Change account details']", /Sign out everywhere/],
      pad: 40,
    },
  },
];
