"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "parallax-site-motion";
export const MOTION_EVENT = "lp:motion";

type Star = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinkle: boolean;
  delay: number;
};
type Sparkle = { x: number; y: number; size: number; delay: number };

/** Small seeded generator, so the server and the browser draw the same sky. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function makeStars(
  count: number,
  seed: number,
  sizes: [number, number],
  opacity: [number, number],
): Star[] {
  const r = rng(seed);
  return Array.from({ length: count }, () => ({
    x: r() * 100,
    y: r() * 100,
    size: sizes[0] + r() * (sizes[1] - sizes[0]),
    opacity: opacity[0] + r() * (opacity[1] - opacity[0]),
    twinkle: r() < 0.18,
    delay: r() * 6,
  }));
}

function makeSparkles(count: number, seed: number): Sparkle[] {
  const r = rng(seed);
  return Array.from({ length: count }, () => ({
    x: 6 + r() * 88,
    y: 4 + r() * 92,
    size: 11 + r() * 9,
    delay: r() * 8,
  }));
}

// Three depths: far stars barely move, near ones move more. The logo's own sparkle shape is used for a few.
const LAYERS = [
  { speed: 0.06, stars: makeStars(70, 11, [1, 1.6], [0.25, 0.55]), sparkles: [] as Sparkle[] },
  { speed: 0.14, stars: makeStars(34, 23, [1.4, 2.2], [0.35, 0.7]), sparkles: makeSparkles(3, 5) },
  { speed: 0.26, stars: makeStars(14, 37, [2, 3], [0.45, 0.85]), sparkles: makeSparkles(3, 9) },
];

function Sparkles({ items }: { items: Sparkle[] }) {
  return items.map((s, i) => (
    <svg
      key={i}
      viewBox="0 0 20 20"
      className="lp-sparkle"
      style={{
        left: `${s.x}%`,
        top: `${s.y}%`,
        width: s.size,
        height: s.size,
        animationDelay: `${s.delay}s`,
      }}
    >
      <circle cx="10" cy="10" r="1.8" fill="currentColor" />
      <line x1="10" y1="1" x2="10" y2="19" stroke="currentColor" strokeWidth="0.9" opacity="0.55" />
      <line x1="1" y1="10" x2="19" y2="10" stroke="currentColor" strokeWidth="0.9" opacity="0.55" />
    </svg>
  ));
}

/** The drifting star field. Decorative only, so it is hidden from assistive technology. */
export function Stars() {
  return (
    <div className="lp-sky" aria-hidden="true">
      {LAYERS.map((layer, li) => (
        <div key={li} className="lp-layer" data-speed={layer.speed}>
          {[0, 1].map((tile) => (
            <div key={tile} className="lp-tile">
              {layer.stars.map((s, i) => (
                <span
                  key={i}
                  className={s.twinkle ? "lp-star lp-twinkle" : "lp-star"}
                  style={{
                    left: `${s.x}%`,
                    top: `${s.y}%`,
                    width: s.size,
                    height: s.size,
                    opacity: s.opacity,
                    animationDelay: `${s.delay}s`,
                  }}
                />
              ))}
              <Sparkles items={layer.sparkles} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Owns everything that moves on the landing page: the sky and `[data-parallax]` drift on scroll, the
 * reveal-on-scroll classes, smooth scrolling for in-page links, and the "Pause animations" switch.
 * Motion is off when the visitor's system asks for less motion, or when they switch it off here.
 * Everything is readable and usable with motion off.
 */
export function Motion({ rootId }: { rootId: string }) {
  const [off, setOff] = useState(false);
  const offRef = useRef(false);

  const apply = useCallback(
    (value: boolean) => {
      offRef.current = value;
      setOff(value);
      const root = document.getElementById(rootId);
      if (root) root.dataset.motion = value ? "off" : "on";
      window.dispatchEvent(new CustomEvent(MOTION_EVENT, { detail: { off: value } }));
    },
    [rootId],
  );

  // Starting state: a saved choice wins, otherwise follow the system setting.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage can be unavailable (private mode); fall back to the system setting
    }
    apply(saved ? saved === "off" : prefersReducedMotion());
    document.getElementById(rootId)?.setAttribute("data-js", "");
  }, [apply, rootId]);

  // Follow the system setting if it changes while the page is open and no choice has been saved.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return;
      } catch {
        // ignore
      }
      apply(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [apply]);

  // Scroll-linked drift (sky layers and [data-parallax] elements), throttled to one update per frame.
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root || off) {
      document.querySelectorAll<HTMLElement>(".lp-layer, [data-parallax]").forEach((el) => {
        el.style.transform = "";
      });
      return;
    }
    const layers = [...root.querySelectorAll<HTMLElement>(".lp-layer")];
    const drifters = [...root.querySelectorAll<HTMLElement>("[data-parallax]")];
    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      const y = window.scrollY;
      for (const el of layers) {
        const speed = Number(el.dataset.speed);
        el.style.transform = `translate3d(0, ${-((y * speed) % vh)}px, 0)`;
      }
      for (const el of drifters) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > vh + 200) continue;
        const offset = rect.top + rect.height / 2 - vh / 2;
        el.style.transform = `translate3d(0, ${(offset * Number(el.dataset.parallax)).toFixed(1)}px, 0)`;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [off, rootId]);

  // Reveal-on-scroll: sections fade and rise into place once. With motion off everything is simply visible.
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (off || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.setAttribute("data-visible", ""));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.setAttribute("data-visible", "");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [off, rootId]);

  // In-page links scroll smoothly (instantly with motion off), then move focus to the target and update the address.
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey)
        return;
      const target = document.getElementById(link.getAttribute("href")!.slice(1));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: offRef.current ? "auto" : "smooth", block: "start" });
      history.replaceState(null, "", link.getAttribute("href"));
      target.focus({ preventScroll: true });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [rootId]);

  return (
    <button
      type="button"
      className="lp-motion-toggle"
      onClick={() => {
        const next = !off;
        try {
          localStorage.setItem(STORAGE_KEY, next ? "off" : "on");
        } catch {
          // not saved, still applies for this visit
        }
        apply(next);
      }}
    >
      <span aria-hidden="true">{off ? "▶" : "❚❚"}</span>
      {off ? "Play animations" : "Pause animations"}
    </button>
  );
}
