import { useState } from "react";
import { ImageOff } from "lucide-react";
import { imageApi } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Image-library thumbnail with a placeholder-until-loaded state — the image
 * twin of `VideoThumbnail`. Thumbnails are generated lazily on first request
 * (see backend `get_or_create_image_thumbnail`) rather than during the scan, so
 * a card can't assume one exists yet: the `<img>` is always mounted and asks for
 * it, and the placeholder shows until it loads (or permanently on error).
 *
 * The wrapping element must be `position: relative` and give the card its size.
 */
export function ImageThumbnail({
  imageId,
  scannedAt,
  alt,
  imgClassName,
  iconClassName = "h-8 w-8 text-muted-foreground/40",
}: {
  imageId: number;
  scannedAt?: string | null;
  alt: string;
  imgClassName?: string;
  iconClassName?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  return (
    <>
      {!errored && (
        <img
          src={imageApi.thumbnailUrl(imageId, scannedAt ?? undefined)}
          alt={alt}
          className={cn("absolute inset-0 w-full h-full", imgClassName, !loaded && "opacity-0")}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          loading="lazy"
        />
      )}
      {(!loaded || errored) && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <ImageOff className={iconClassName} />
        </div>
      )}
    </>
  );
}
