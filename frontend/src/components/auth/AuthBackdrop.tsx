import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Stacked 4:3 frames (the shape of a thumbnail in the library) at different depths. Moving the
 * pointer shifts each one by its own amount, which is the effect the app is named for. The
 * pointer position goes into two CSS variables, so nothing re-renders while it moves.
 */
const FRAMES = [
  // depth = pixels of travel at the screen edge; the far frames move least.
  { cls: "left-[6%] top-[10%] w-[34vmin] bg-px-surface", depth: 14 },
  { cls: "right-[8%] top-[18%] w-[26vmin] border border-primary/25", depth: 26 },
  { cls: "left-[14%] bottom-[8%] w-[22vmin] border border-border", depth: 38 },
  { cls: "right-[12%] bottom-[12%] w-[38vmin] bg-px-elevated", depth: 20 },
  { cls: "left-[44%] top-[4%] w-[14vmin] border border-primary/40", depth: 52 },
] as const;

export function AuthBackdrop({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: PointerEvent) => {
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
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={{ "--mx": 0, "--my": 0 } as React.CSSProperties}
    >
      {FRAMES.map((f, i) => (
        <div
          key={i}
          className={cn(
            "absolute aspect-[4/3] rounded-[0.4rem] opacity-70 transition-transform duration-300 ease-out",
            f.cls,
          )}
          style={{
            transform: `translate3d(calc(var(--mx) * ${f.depth}px * -1), calc(var(--my) * ${f.depth}px * -1), 0)`,
          }}
        />
      ))}
    </div>
  );
}
