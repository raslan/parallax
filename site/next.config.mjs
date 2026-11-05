import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Static export: no server runtime. Deployed as plain files.
  output: "export",
  images: { unoptimized: true },
  // site/ is its own package inside the app repo; pin the root so Next doesn't pick the repo-root lockfile.
  turbopack: { root: import.meta.dirname },
};

export default withMDX(config);
