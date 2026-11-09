import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

/**
 * A slow rain of stars behind the sign-in card, in three depth layers: the far ones are small,
 * dim and barely move, the near ones are brighter, drawn as short streaks, and fall faster.
 * Moving the pointer also shifts each layer by its own amount. Different speeds at different
 * depths is the effect the app is named for, and the logo's star and the public site's sky
 * share the look. Colours are theme tokens.
 *
 * Motion rules: nothing moves under `prefers-reduced-motion` (no animation, no pointer
 * tracking, and no pause button since there is nothing to pause); otherwise a visible
 * "Pause animation" button freezes everything, and the choice is remembered. The pointer goes
 * into two CSS variables, so nothing re-renders while it moves; touch screens get only the rain.
 */

interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
  accent: boolean;
}

const PAUSED_KEY = "parallax-auth-sky-paused";

function readPaused(): boolean {
  try {
    return localStorage.getItem(PAUSED_KEY) === "1";
  } catch {
    return false; // storage blocked: the sky just isn't remembered
  }
}

// Fixed seed: the same sky on every visit, and no flicker between renders.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAYERS = [
  // depth: pixels of pointer travel at the screen edge. fall: seconds for one tile to pass.
  // streak: how stretched a star is (1 = a dot), so near stars read as falling.
  { count: 70, r: [0.5, 0.9], o: [0.15, 0.4], depth: 6, fall: 150, streak: 1, accentShare: 0 },
  { count: 34, r: [0.9, 1.3], o: [0.3, 0.6], depth: 16, fall: 90, streak: 2, accentShare: 0.1 },
  { count: 14, r: [1.2, 1.8], o: [0.5, 0.85], depth: 34, fall: 55, streak: 3.4, accentShare: 0.4 },
] as const;

function makeStars(layer: (typeof LAYERS)[number], seed: number): Star[] {
  const rand = mulberry32(seed);
  const between = ([lo, hi]: readonly [number, number]) => lo + rand() * (hi - lo);
  return Array.from({ length: layer.count }, () => ({
    x: rand() * 1000,
    y: rand() * 1000,
    r: between(layer.r),
    o: between(layer.o),
    accent: rand() < layer.accentShare,
  }));
}

function Tile({ stars, streak, className }: { stars: Star[]; streak: number; className: string }) {
  return (
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className={className}>
      {stars.map((s, j) => (
        <ellipse
          key={j}
          cx={s.x}
          cy={s.y}
          rx={s.r}
          ry={s.r * streak}
          opacity={s.o}
          fill={s.accent ? "hsl(var(--primary))" : "hsl(var(--foreground))"}
        />
      ))}
    </svg>
  );
}

export function AuthSky() {
  const ref = useRef<HTMLDivElement>(null);
  const layers = useMemo(() => LAYERS.map((l, i) => makeStars(l, 1000 + i * 77)), []);
  const [paused, setPaused] = useState(readPaused);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || paused) {
      // Frozen: let the layers settle back to the middle.
      el.style.setProperty("--mx", "0");
      el.style.setProperty("--my", "0");
      return;
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      el.style.setProperty("--mx", String((e.clientX / window.innerWidth - 0.5) * 2));
      el.style.setProperty("--my", String((e.clientY / window.innerHeight - 0.5) * 2));
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [paused]);

  function toggle() {
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem(PAUSED_KEY, next ? "1" : "0");
    } catch {
      // storage blocked: the choice just lasts until the page is reloaded
    }
  }

  return (
    <>
      <div
        ref={ref}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ "--mx": 0, "--my": 0 } as React.CSSProperties}
      >
        {/* A soft pool of the theme's accent behind the card. */}
        <div className="absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_42%,hsl(var(--primary)/0.10),transparent_70%)]" />
        {LAYERS.map((layer, i) => (
          // Outer: follows the pointer. Inner: falls. Two stacked tiles make the loop seamless.
          <div
            key={i}
            // Larger than the screen, so shifting never shows an edge.
            className="absolute -inset-[6%] transition-transform duration-300 ease-out"
            style={{
              transform: `translate3d(calc(var(--mx) * ${layer.depth}px * -1), calc(var(--my) * ${layer.depth}px * -1), 0)`,
            }}
          >
            <div
              className="absolute inset-0 motion-safe:animate-star-fall"
              style={
                {
                  "--fall": `${layer.fall}s`,
                  animationPlayState: paused ? "paused" : "running",
                } as React.CSSProperties
              }
            >
              <Tile
                stars={layers[i]!}
                streak={layer.streak}
                className="absolute inset-0 h-full w-full"
              />
              <Tile
                stars={layers[i]!}
                streak={layer.streak}
                className="absolute inset-x-0 -top-full h-full w-full"
              />
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={toggle}
        className="absolute bottom-4 right-4 z-20 inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:hidden"
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {paused ? "Play animation" : "Pause animation"}
      </button>
    </>
  );
}
