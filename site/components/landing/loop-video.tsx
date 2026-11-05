"use client";

import { useEffect, useRef, useState } from "react";
import { MOTION_EVENT } from "./motion";

type Props = {
  /** Path under /media, e.g. "features/cleanup/duration-filter". Expects `.mp4` and `.poster.webp`. */
  id: string;
  /** What the clip shows, for people who cannot see it. */
  alt: string;
  width: number;
  height: number;
};

/**
 * A short muted loop of the real app. It loads only when it is near the screen, plays only while it is
 * visible, and shows its first frame instead when motion is off. The video itself is hidden from assistive
 * technology; the wrapper carries the description.
 */
export function LoopVideo({ id, alt, width, height }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [off, setOff] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const load = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), {
      rootMargin: "600px 0px",
    });
    const view = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), {
      threshold: 0.35,
    });
    load.observe(video);
    view.observe(video);
    const onMotion = (e: Event) => setOff((e as CustomEvent<{ off: boolean }>).detail.off);
    window.addEventListener(MOTION_EVENT, onMotion);
    const root = video.closest<HTMLElement>("[data-motion]");
    if (root) setOff(root.dataset.motion === "off");
    return () => {
      load.disconnect();
      view.disconnect();
      window.removeEventListener(MOTION_EVENT, onMotion);
    };
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video || !near) return;
    if (visible && !off) {
      void video.play().catch(() => {
        // autoplay can be refused; the poster stays on screen, which is fine
      });
    } else {
      video.pause();
      if (off) video.currentTime = 0;
    }
  }, [near, visible, off]);

  return (
    <div
      className="lp-clip"
      role="img"
      aria-label={alt}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <video
        ref={ref}
        aria-hidden="true"
        tabIndex={-1}
        muted
        loop
        playsInline
        preload="none"
        poster={`/media/${id}.poster.webp`}
        src={near ? `/media/${id}.mp4` : undefined}
        width={width}
        height={height}
      />
    </div>
  );
}
