import { useEffect, useMemo, useRef } from "react";

/**
 * A quiet night sky behind the sign-in card: three layers of stars at different depths. Moving
 * the pointer shifts each layer by its own amount (far ones barely, near ones most), which is
 * the effect the app is named for and the one the logo's star and the public site's sky share.
 * The pointer position goes into two CSS variables, so nothing re-renders while it moves, and
 * nothing moves at all under reduced motion or on touch screens. Colours are theme tokens.
 */

interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
  accent: boolean;
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
  // depth = pixels of travel at the screen edge.
  { count: 70, r: [0.5, 0.9], o: [0.15, 0.4], depth: 6, accentShare: 0 },
  { count: 34, r: [0.9, 1.4], o: [0.3, 0.6], depth: 16, accentShare: 0.1 },
  { count: 12, r: [1.4, 2.2], o: [0.5, 0.85], depth: 34, accentShare: 0.4 },
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

export function AuthSky() {
  const ref = useRef<HTMLDivElement>(null);
  const layers = useMemo(() => LAYERS.map((l, i) => makeStars(l, 1000 + i * 77)), []);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      el.style.setProperty("--mx", String((e.clientX / window.innerWidth - 0.5) * 2));
      el.style.setProperty("--my", String((e.clientY / window.innerHeight - 0.5) * 2));
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ "--mx": 0, "--my": 0 } as React.CSSProperties}
    >
      {/* A soft pool of the theme's accent behind the card. */}
      <div className="absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_42%,hsl(var(--primary)/0.10),transparent_70%)]" />
      {LAYERS.map((layer, i) => (
        <svg
          key={i}
          viewBox="0 0 1000 1000"
          preserveAspectRatio="xMidYMid slice"
          // Larger than the screen, so shifting never shows an edge.
          className="absolute -inset-[6%] h-[112%] w-[112%] transition-transform duration-300 ease-out"
          style={{
            transform: `translate3d(calc(var(--mx) * ${layer.depth}px * -1), calc(var(--my) * ${layer.depth}px * -1), 0)`,
          }}
        >
          {layers[i]!.map((s, j) => (
            <circle
              key={j}
              cx={s.x}
              cy={s.y}
              r={s.r}
              opacity={s.o}
              fill={s.accent ? "hsl(var(--primary))" : "hsl(var(--foreground))"}
            />
          ))}
        </svg>
      ))}
    </div>
  );
}
