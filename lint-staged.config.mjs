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
  "backend/**/*.py": (absolutePaths) => {
    const quoted = absolutePaths.map((p) => JSON.stringify(p)).join(" ");
    return [`ruff check --fix ${quoted}`, `ruff format ${quoted}`];
  },
};
