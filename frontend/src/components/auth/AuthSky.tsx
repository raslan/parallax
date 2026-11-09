import { useMemo, useState } from "react";
import { Pause, Play } from "lucide-react";

/**
 * A slow rain of stars behind the sign-in card, made the same way as the public site's sky:
 * round dots at three depths (far ones small and dim, near ones bigger and brighter), some
 * twinkling, and a few sparkles in the shape of the logo's star. Each depth falls at its own
 * pace, which is what gives it depth. The sky does not react to the mouse.
 *
 * Motion rules: nothing moves under `prefers-reduced-motion` (and the pause button is hidden,
 * since there is nothing to pause); otherwise a visible "Pause animation" button freezes the
 * sky, and the choice is remembered. Colours are theme tokens.
 */

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinkle: boolean;
  delay: number;
}
interface Sparkle {
  x: number;
  y: number;
  size: number;
  delay: number;
}

const PAUSED_KEY = "parallax-auth-sky-paused";

function readPaused(): boolean {
  try {
    return localStorage.getItem(PAUSED_KEY) === "1";
  } catch {
    return false; // storage blocked: the sky just isn't remembered
  }
}

/** Small seeded generator: the same sky on every visit, and no flicker between renders. */
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

// Three depths. `fall` is the seconds one screen-height of sky takes to pass: far is slowest.
const LAYERS = [
  { fall: 180, stars: makeStars(70, 11, [1, 1.6], [0.25, 0.55]), sparkles: [] as Sparkle[] },
  { fall: 110, stars: makeStars(34, 23, [1.4, 2.2], [0.35, 0.7]), sparkles: makeSparkles(3, 5) },
  { fall: 70, stars: makeStars(14, 37, [2, 3], [0.45, 0.85]), sparkles: makeSparkles(3, 9) },
];

function Tile({ layer }: { layer: (typeof LAYERS)[number] }) {
  return (
    <div className="relative h-1/2">
      {layer.stars.map((s, i) => (
        <span
          key={i}
          className={`absolute rounded-full bg-foreground ${s.twinkle ? "motion-safe:animate-twinkle" : ""}`}
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
      {layer.sparkles.map((s, i) => (
        <svg
          key={i}
          viewBox="0 0 20 20"
          className="absolute text-primary opacity-80 motion-safe:animate-twinkle"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            animationDelay: `${s.delay}s`,
          }}
        >
          <circle cx="10" cy="10" r="1.8" fill="currentColor" />
          <line
            x1="10"
            y1="1"
            x2="10"
            y2="19"
            stroke="currentColor"
            strokeWidth="0.9"
            opacity="0.55"
          />
          <line
            x1="1"
            y1="10"
            x2="19"
            y2="10"
            stroke="currentColor"
            strokeWidth="0.9"
            opacity="0.55"
          />
        </svg>
      ))}
    </div>
  );
}

export function AuthSky() {
  const layers = useMemo(() => LAYERS, []);
  const [paused, setPaused] = useState(readPaused);

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
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* A soft pool of the theme's accent behind the card. */}
        <div className="absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_42%,hsl(var(--primary)/0.10),transparent_70%)]" />
        {layers.map((layer, i) => (
          // Two identical screen-high tiles, moved down by one screen and wrapped, so it loops
          // without a seam.
          <div
            key={i}
            className="absolute inset-x-0 top-0 h-[200%] motion-safe:animate-star-fall"
            style={
              {
                "--fall": `${layer.fall}s`,
                animationPlayState: paused ? "paused" : "running",
              } as React.CSSProperties
            }
          >
            <Tile layer={layer} />
            <Tile layer={layer} />
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
