import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// Asks well-behaved crawlers to stay out of the documentation. The landing page stays open.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: ["/docs", "/api/search"] },
  };
}
