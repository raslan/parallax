import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Static export: no server runtime. Deployed as plain files.
  output: "export",
  images: { unoptimized: true },
  // The dev-mode "N" badge covers the sidebar's GitHub link.
  devIndicators: false,
  // The dev machine is headless and reached over the LAN; without this Next blocks HMR/JS from that origin.
  allowedDevOrigins: ["192.168.1.13"],
  // site/ is its own package inside the app repo; pin the root so Next doesn't pick the repo-root lockfile.
  turbopack: { root: import.meta.dirname },
};

export default withMDX(config);
