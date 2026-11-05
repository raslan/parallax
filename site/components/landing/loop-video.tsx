"use client";

import { useEffect, useRef, useState } from "react";
import { MOTION_EVENT } from "./motion";

/** A camera position: the part of the clip to show, as fractions of its width and height. */
export type CameraKey = { t: number; x: number; y: number; w: number; h: number };

type Props = {
  /** Path under /media, e.g. "landing/beats/cleanup". Expects `.mp4` and `.poster.webp`, and `.webm` if `webm`. */
  id: string;
  /** What the clip shows, for people who cannot see it. */
  alt: string;
  width: number;
  height: number;
  /** The clip also exists as a smaller WebM, which is tried first. */
  webm?: boolean;
  /** Recorded camera moves (zoom in on the part that matters, then back out). Played while the clip plays. */
  camera?: CameraKey[];
};

const ease = (p: number) => p * p * p * (p * (p * 6 - 15) + 10); // smootherstep: gentle start and finish
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MAX_ZOOM = 3.2;

/** The camera rectangle at time `t`, easing between the recorded positions. */
function rectAt(camera: CameraKey[], t: number): CameraKey {
  const first = camera[0]!;
  if (t <= first.t) return first;
  for (let i = 1; i < camera.length; i++) {
    const a = camera[i - 1]!;
    const b = camera[i]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      const p = span > 0 ? ease((t - a.t) / span) : 1;
      return {
        t,
        x: lerp(a.x, b.x, p),
        y: lerp(a.y, b.y, p),
        w: lerp(a.w, b.w, p),
        h: lerp(a.h, b.h, p),
      };
    }
  }
  return camera[camera.length - 1]!;
}

/** CSS transform that frames `r` in the clip's box (origin top left), never showing outside the video. */
function frame(r: CameraKey): string {
  const s = clamp(Math.min(1 / r.w, 1 / r.h), 1, MAX_ZOOM);
  const tx = clamp(0.5 - (r.x + r.w / 2) * s, 1 - s, 0) * 100;
  const ty = clamp(0.5 - (r.y + r.h / 2) * s, 1 - s, 0) * 100;
  return `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${s.toFixed(4)})`;
}

/**
 * A short muted loop of the real app. It loads only when it is near the screen, plays only while it is
 * visible, and shows its first frame, whole and still, when motion is off. With a recorded camera it also
 * glides in on the part of the app being used, then back out. The video itself is hidden from assistive
 * technology; the wrapper carries the description.
 */
export function LoopVideo({ id, alt, width, height, webm, camera }: Props) {
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
    // Watch the frame around the video: while the camera is zoomed in, the video itself overflows it.
    const box = video.parentElement ?? video;
    load.observe(box);
    view.observe(box);
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

  // The sources are only added once the clip is near the screen, so the browser has to be told to look at them.
  useEffect(() => {
    if (near) ref.current?.load();
  }, [near]);

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

  // The camera: follow the video's clock for as long as it is playing and motion is on.
  useEffect(() => {
    const video = ref.current;
    if (!video || !camera?.length) return;
    if (off || !visible || !near) {
      video.style.transform = "";
      return;
    }
    let raf = 0;
    const tick = () => {
      video.style.transform = frame(rectAt(camera, video.currentTime));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [camera, near, visible, off]);

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
        width={width}
        height={height}
        style={camera?.length ? { transformOrigin: "0 0", willChange: "transform" } : undefined}
      >
        {near && webm && <source src={`/media/${id}.webm`} type="video/webm" />}
        {near && <source src={`/media/${id}.mp4`} type="video/mp4" />}
      </video>
    </div>
  );
}
