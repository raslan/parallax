import path from "node:path";

const repoRoot = import.meta.dirname;
const frontendBinDir = path.resolve(repoRoot, "frontend/node_modules/.bin");

export default {
  "frontend/**/*.{ts,tsx}": (absolutePaths) => {
    const quoted = absolutePaths.map((p) => JSON.stringify(p)).join(" ");
    return [
      `${path.join(frontendBinDir, "eslint")} --config frontend/eslint.config.js --fix ${quoted}`,
      `${path.join(frontendBinDir, "prettier")} --config frontend/.prettierrc.json --write ${quoted}`,
    ];
  },
  // The public site (site/) is its own package; reuse the frontend's prettier + config for formatting.
  "site/**/*.{ts,tsx,mjs,json,css,mdx}": (absolutePaths) => {
    const files = absolutePaths.filter((p) => !p.includes("/site/public/"));
    if (files.length === 0) return [];
    const quoted = files.map((p) => JSON.stringify(p)).join(" ");
    return [`${path.join(frontendBinDir, "prettier")} --config frontend/.prettierrc.json --write ${quoted}`];
  },
  // Coverage + forbidden-terms checks for the public site (source-only, no build needed). Also runs when the
  // app's nav changes, since every nav route must be covered by a docs page. See site/scripts/check-coverage.mjs.
  "{site/**,frontend/src/components/layout/nav-config.ts,frontend/src/lib/docsRoutes.json}": () => ["npm --prefix site run check:quick"],
  "backend/**/*.py": (absolutePaths) => {
    const quoted = absolutePaths.map((p) => JSON.stringify(p)).join(" ");
    return [`ruff check --fix ${quoted}`, `ruff format ${quoted}`];
  },
};
