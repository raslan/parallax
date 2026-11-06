"use client";

import { useRef } from "react";
import { DEFAULT_THEME, THEMES } from "@/lib/themes.generated";
import { themedId } from "@/lib/theme-assets";
import { useTheme } from "@/lib/use-theme";

type Props = {
  /** Base path under /media without extension, e.g. "landing/hero/files-grid". */
  id: string;
  alt: string;
  width: number;
  height: number;
  /** Smaller copies, in CSS pixels, as produced by the capture tool's `variants`. */
  variants: number[];
  /** `sizes` for the inline image. */
  sizes: string;
  /** A phone-sized capture of the same screen, used under 768px wide. */
  mobile?: { id: string; width: number; height: number };
  priority?: boolean;
};

// One picture per theme, and a stylesheet that shows only the one for the theme on <html>. That way the right
// colours are there on first paint, with no script and no flash of the default look. The hidden ones are lazy,
// so the browser never downloads them.
const SHOW_ONLY_CURRENT = THEMES.map(
  (t) => `html[data-theme="${t.id}"] .lp-zoom picture[data-theme-for="${t.id}"]{display:contents}`,
).join("");
const HIDE_OTHERS = ".lp-zoom picture[data-theme-for]{display:none}";

function Pic({
  id,
  alt,
  width,
  height,
  variants,
  sizes,
  mobile,
  priority,
  theme,
}: Props & { theme: string }) {
  const base = themedId(id, theme);
  const srcSet = [
    ...variants.map((w) => `/media/${base}-${w}w.webp ${w * 2}w`),
    `/media/${base}.webp ${width * 2}w`,
  ].join(", ");
  return (
    <picture data-theme-for={theme}>
      {mobile && (
        <source
          media="(max-width: 767px)"
          srcSet={`/media/${themedId(mobile.id, theme)}.webp`}
          width={mobile.width}
          height={mobile.height}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/media/${base}.webp`}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        width={width}
        height={height}
        fetchPriority={priority && theme === DEFAULT_THEME ? "high" : undefined}
        loading={priority && theme === DEFAULT_THEME ? "eager" : "lazy"}
        decoding="async"
      />
    </picture>
  );
}

/**
 * A screenshot of the app that opens full size in a dialog when clicked, shown in whichever theme the visitor
 * picked. The dialog is the browser's own `<dialog>`, so focus stays inside it, Escape closes it, and the
 * page behind it is inert.
 */
export function ZoomImage(props: Props) {
  const { id, alt, width, height, mobile } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const theme = useTheme();

  return (
    <>
      <style>{HIDE_OTHERS + SHOW_ONLY_CURRENT}</style>
      <button
        type="button"
        className="lp-zoom"
        aria-label="View the screenshot full size"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        {THEMES.map((t) => (
          <Pic key={t.id} {...props} theme={t.id} />
        ))}
      </button>
      <dialog
        ref={dialog}
        className="lp-dialog"
        aria-label="Screenshot, full size"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <form method="dialog">
          <button className="lp-dialog-close" aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </form>
        <picture>
          {mobile && (
            <source
              media="(max-width: 767px)"
              srcSet={`/media/${themedId(mobile.id, theme)}.webp`}
              width={mobile.width}
              height={mobile.height}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/media/${themedId(id, theme)}.webp`}
            alt={alt}
            width={width}
            height={height}
            loading="lazy"
          />
        </picture>
      </dialog>
    </>
  );
}
