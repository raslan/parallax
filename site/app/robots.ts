import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// Asks well-behaved crawlers to skip the few pages that name the download tools, and the
// search index (which contains every page's text). Everything else stays crawlable.
// Keep this list in step with the pages that mention yt-dlp or gallery-dl.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: [
        "/docs/tools/downloads",
        "/docs/tools/galleries",
        "/docs/api",
        "/docs/acknowledgements",
        "/api/search",
      ],
    },
  };
}
