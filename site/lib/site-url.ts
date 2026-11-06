/**
 * The address the site is served from, for canonical links, the sitemap and link previews.
 * On Vercel it is the production domain (the custom one if there is one); locally, localhost.
 * Set NEXT_PUBLIC_SITE_URL to override.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000")
).replace(/\/$/, "");

export const SITE_NAME = "Parallax";
export const SITE_DESCRIPTION =
  "Parallax is a free, open source toolkit that sits alongside your media player and looks after the files behind it. Organize, identify, filter, de-duplicate and compress your videos, photos and music.";
