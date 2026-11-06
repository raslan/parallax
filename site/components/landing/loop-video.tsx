"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_THEME } from "@/lib/themes.generated";
import { useTheme } from "@/lib/use-theme";
import { MOTION_EVENT } from "./motion";

/** A camera position: the part of the clip to show, as fractions of its width and height. */
export type CameraKey = {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** One filming of the clip: where its files are under /media, and the camera moves recorded while filming. */
export type ClipTake = { id: string; camera: CameraKey[] };

type Props = {
  /** What the clip shows, for people who cannot see it. */
  alt: string;
  width: number;
  height: number;
  /**
   * The take for each theme, keyed by theme id. `id` is a path under /media, e.g. "landing/beats/cleanup",
   * and expects `.mp4` and `.poster.webp`. A theme with no take uses the default theme's.
   */
  takes: Record<string, ClipTake>;
};

const ease = (p: number) => p * p * p * (p * (p * 6 - 15) + 10); // smootherstep: gentle start and finish
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MAX_ZOOM = 3.2;
const FADE_MS = 250;

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
 * visible, and shows a still of its finished state, whole, when motion is off. With a recorded camera it
 * also glides in on the part of the app being used, then back out.
 *
 * It exists once per theme. Picking another theme while it plays loads the new take in a second video
 * behind the first, jumps it to the same point in the loop, and crossfades; the old take stays on screen
 * until the new one is ready. The videos are hidden from assistive technology; the wrapper carries the
 * description.
 */
export function LoopVideo({ alt, width, height, takes }: Props) {
  const theme = useTheme();
  const takeFor = (t: string) => takes[t] ?? takes[DEFAULT_THEME]!;

  const videos = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  // Which theme's take each of the two videos holds, and which of them is showing.
  const [held, setHeld] = useState<[string, string]>([DEFAULT_THEME, DEFAULT_THEME]);
  const [front, setFront] = useState<0 | 1>(0);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [off, setOff] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const swap = useRef(0); // which swap is current; a newer theme pick makes older ones give up
  const back = front === 0 ? 1 : 0;

  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const load = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), {
      rootMargin: "600px 0px",
    });
    const view = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), {
      threshold: 0.35,
    });
    // Watch the frame around the videos: while the camera is zoomed in, the video itself overflows it.
    load.observe(box);
    view.observe(box);
    const onMotion = (e: Event) => setOff((e as CustomEvent<{ off: boolean }>).detail.off);
    window.addEventListener(MOTION_EVENT, onMotion);
    const root = box.closest<HTMLElement>("[data-motion]");
    if (root) setOff(root.dataset.motion === "off");
    return () => {
      load.disconnect();
      view.disconnect();
      window.removeEventListener(MOTION_EVENT, onMotion);
    };
  }, []);

  const playing = near && visible && !off;

  // The theme changed: swap takes.
  useEffect(() => {
    if (held[front] === theme) return;
    const mine = ++swap.current;
    const from = videos[front]!.current;
    const to = videos[back]!.current;
    if (!playing || !from || !to || !(from.duration > 0)) {
      // Nothing is playing, so there is nothing to keep going: just change the take (and with it the still).
      setHeld((h) => (front === 0 ? [theme, h[1]] : [h[0], theme]));
      return;
    }
    const fraction = from.currentTime / from.duration;
    setHeld((h) => (back === 0 ? [theme, h[1]] : [h[0], theme]));
    // The new take's source is set on the next render; wait for it, jump to the same point, then fade.
    const ready = () => {
      if (swap.current !== mine) return;
      to.currentTime = fraction * to.duration;
      to.addEventListener(
        "seeked",
        () => {
          if (swap.current !== mine) return;
          void to.play().catch(() => {});
          setFront(back);
          window.setTimeout(() => {
            if (swap.current === mine) from.pause();
          }, FADE_MS + 50);
        },
        { once: true },
      );
    };
    to.addEventListener("loadeddata", ready, { once: true });
    return () => to.removeEventListener("loadeddata", ready);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // A take whose source changed needs telling to look at it (the sources are only set once the clip is near).
  useEffect(() => {
    if (near) videos[front]!.current?.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, held[front]]);
  useEffect(() => {
    if (near && held[back] !== held[front]) videos[back]!.current?.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held[back]]);

  // Play the front video while the clip is on screen; hold still (rewound, when motion is off) otherwise.
  useEffect(() => {
    const v = videos[front]!.current;
    if (!v || !near) return;
    if (playing) {
      void v.play().catch(() => {
        // autoplay can be refused; the poster stays on screen, which is fine
      });
    } else {
      v.pause();
      if (off) v.currentTime = 0;
      videos[back]!.current?.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, visible, off, front]);

  // The camera: follow each video's own clock while the clip plays.
  useEffect(() => {
    const els = videos.map((r) => r.current);
    if (!playing) {
      for (const el of els) if (el) el.style.transform = "";
      return;
    }
    let raf = 0;
    const tick = () => {
      els.forEach((el, i) => {
        const cam = takeFor(held[i]!).camera;
        if (el && cam.length) el.style.transform = frame(rectAt(cam, el.currentTime));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, held, takes]);

  return (
    <div
      ref={wrap}
      className="lp-clip"
      role="img"
      aria-label={alt}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {([0, 1] as const).map((i) => {
        const take = takeFor(held[i]);
        // The spare video only gets a source while a different take is waiting in it.
        const hasSource = near && (i === front || held[i] !== held[front]);
        return (
          <video
            key={i}
            ref={videos[i]}
            aria-hidden="true"
            tabIndex={-1}
            muted
            loop
            playsInline
            preload={i === front ? "none" : "auto"}
            // The still loads with the clip (when it is near the screen), not with the page.
            poster={near ? `/media/${take.id}.poster.webp` : undefined}
            src={hasSource ? `/media/${take.id}.mp4` : undefined}
            width={width}
            height={height}
            data-front={front === i ? "" : undefined}
            style={
              take.camera.length ? { transformOrigin: "0 0", willChange: "transform" } : undefined
            }
          />
        );
      })}
    </div>
  );
}
