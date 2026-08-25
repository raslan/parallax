import path from "node:path";

const frontendDir = path.resolve(import.meta.dirname, "frontend");

export default {
  "frontend/**/*.{ts,tsx}": (absolutePaths) => {
    const relative = absolutePaths.map((p) => path.relative(frontendDir, p));
    const quoted = relative.map((p) => JSON.stringify(p)).join(" ");
    return [
      `cd frontend && npx eslint --fix ${quoted}`,
      `cd frontend && npx prettier --write ${quoted}`,
    ];
  },
  "backend/**/*.py": (absolutePaths) => {
    const quoted = absolutePaths.map((p) => JSON.stringify(p)).join(" ");
    return [`ruff check --fix ${quoted}`, `ruff format ${quoted}`];
  },
};
