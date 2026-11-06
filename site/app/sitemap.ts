import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { SITE_URL } from "@/lib/site-url";

export const dynamic = "force-static";

// Pages that ask crawlers to stay away (see robots.ts) are left out, so the sitemap never contradicts it.
const SKIP = [
  "/docs/tools/downloads",
  "/docs/tools/galleries",
  "/docs/api",
  "/docs/acknowledgements",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = source
    .getPages()
    .map((p) => p.url)
    .filter((url) => !SKIP.some((s) => url === s || url.startsWith(`${s}/`)));
  return ["/", ...docs].map((path) => ({ url: `${SITE_URL}${path === "/" ? "" : path}` }));
}
