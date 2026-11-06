import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site-url";

/** The link-preview image (see scripts/og-image.mjs). */
export const PREVIEW_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "Parallax: the Swiss Army knife for your media library, next to a screenshot of the Files page.",
};

/**
 * Title, description and link-preview tags for one page. Next replaces a layout's `openGraph` wholesale when a
 * page sets its own, so the image and site name are repeated here.
 */
export function pageMetadata(opts: {
  /** Shown in the tab and as the preview title. `absolute` skips the " | Parallax" suffix. */
  title: string | { absolute: string };
  description: string;
  /** Path of the page, e.g. "/docs/features/compress". */
  path: string;
}): Metadata {
  const shown = typeof opts.title === "string" ? opts.title : opts.title.absolute;
  const full = typeof opts.title === "string" ? `${shown} | ${SITE_NAME}` : shown;
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en",
      title: full,
      description: opts.description,
      url: opts.path,
      images: [PREVIEW_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: full,
      description: opts.description,
      images: [PREVIEW_IMAGE],
    },
  };
}
