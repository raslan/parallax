import manifestJson from "@/lib/media-manifest.json";

type Entry = {
  id: string;
  kind: "still" | "clip";
  alt: string;
  src: string;
  poster?: string;
  width: number;
  height: number;
};

const manifest = manifestJson as Record<string, Entry>;

/**
 * A generated screenshot or clip, looked up by shot id (see capture/shots/README.md).
 * An unknown id throws, so a missing asset fails `next build` instead of shipping a broken image.
 */
export function Shot({ id, className }: { id: string; className?: string }) {
  const shot = manifest[id];
  if (!shot) {
    throw new Error(
      `<Shot id="${id}" /> has no entry in lib/media-manifest.json — run npm run capture -- --only ${id}`,
    );
  }
  const base = `/media/${shot.src}`;
  // Portrait shots (option panels, drawers) would otherwise stretch to the full column width and run
  // far taller than the screen, so they keep their shape, centred, and are capped in height.
  const tall = shot.height > shot.width;
  const size = tall ? "mx-auto h-auto max-h-[70vh] w-auto max-w-full" : "h-auto w-full";
  const cls = `my-6 ${size} rounded-lg border border-fd-border ${className ?? ""}`;

  if (shot.kind === "clip") {
    return (
      <video
        className={cls}
        width={shot.width}
        height={shot.height}
        poster={shot.poster ? `/media/${shot.poster}` : undefined}
        aria-label={shot.alt}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      >
        <source src={base} type="video/mp4" />
      </video>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- static export, images are pre-optimised WebP
  return (
    <img
      className={cls}
      src={base}
      alt={shot.alt}
      width={shot.width}
      height={shot.height}
      loading="lazy"
    />
  );
}
