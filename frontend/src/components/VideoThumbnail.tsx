import { useState } from "react";
import { ImageOff } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Video thumbnail with a placeholder-until-loaded state. Thumbnails are now
 * generated lazily on first request (see backend `get_or_create_thumbnail`)
 * rather than eagerly at scan time, so the underlying image can take a
 * moment to arrive the first time a card is viewed — this always shows the
 * placeholder icon until the image actually finishes loading (or shows it
 * permanently on a load error), instead of a blank box in between.
 *
 * The `<img>` is always mounted (with `loading="lazy"`) so the browser's
 * native lazy-loading still ties the request to the card actually scrolling
 * into view, same as before. It's hidden via opacity, not `display:none` —
 * a `loading="lazy"` image with no layout box (display:none) never gets
 * fetched at all in most browsers, since the lazy-load intersection
 * observer has nothing to consider "near the viewport."
 *
 * The caller's wrapping element must be `position: relative` (every current
 * caller's thumbnail container already is, for its own overlay buttons).
 */
export function VideoThumbnail({
  fileId,
  scannedAt,
  alt,
  imgClassName,
  iconClassName = "h-8 w-8 text-muted-foreground/40",
  fallbackClassName,
}: {
  fileId: number;
  scannedAt?: string | null;
  alt: string;
  imgClassName?: string;
  iconClassName?: string;
  fallbackClassName?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  return (
    <>
      {!errored && (
        <img
          src={api.thumbnailUrl(fileId, scannedAt ?? undefined)}
          alt={alt}
          className={cn("absolute inset-0", imgClassName, loaded ? "opacity-100" : "opacity-0")}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          loading="lazy"
        />
      )}
      {(!loaded || errored) && (
        <div
          className={cn("absolute inset-0 flex items-center justify-center", fallbackClassName)}
        >
          <ImageOff className={iconClassName} />
        </div>
      )}
    </>
  );
}
