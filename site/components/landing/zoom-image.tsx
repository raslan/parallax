"use client";

import { useRef } from "react";

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

/**
 * A screenshot of the app that opens full size in a dialog when clicked. The dialog is the browser's own
 * `<dialog>`, so focus stays inside it, Escape closes it, and the page behind it is inert.
 */
export function ZoomImage({ id, alt, width, height, variants, sizes, mobile, priority }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const srcSet = [
    ...variants.map((w) => `/media/${id}-${w}w.webp ${w * 2}w`),
    `/media/${id}.webp ${width * 2}w`,
  ].join(", ");

  return (
    <>
      <button
        type="button"
        className="lp-zoom"
        aria-label="View the screenshot full size"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <picture>
          {mobile && (
            <source
              media="(max-width: 767px)"
              srcSet={`/media/${mobile.id}.webp`}
              width={mobile.width}
              height={mobile.height}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/media/${id}.webp`}
            srcSet={srcSet}
            sizes={sizes}
            alt={alt}
            width={width}
            height={height}
            fetchPriority={priority ? "high" : undefined}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
          />
        </picture>
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
              srcSet={`/media/${mobile.id}.webp`}
              width={mobile.width}
              height={mobile.height}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/media/${id}.webp`} alt={alt} width={width} height={height} />
        </picture>
      </dialog>
    </>
  );
}
