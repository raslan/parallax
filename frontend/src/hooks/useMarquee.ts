import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { itemsInRect, rectBetween, type GridGeometry, type Rect } from "@/lib/marquee";

const DRAG_THRESHOLD = 4;
const EDGE = 48;
const MAX_SCROLL_STEP = 24;
// Controls that own their own click; a drag never starts on them.
const INTERACTIVE = "button, a, input, textarea, select, [role='checkbox'], [role='menuitem']";

/**
 * Windows-style rubber-band selection over a virtualised grid/list. Drag across
 * the items to select what the box touches; Ctrl/Cmd/Shift keeps the existing
 * selection and adds to it. A plain click still toggles, since nothing starts
 * until the pointer has moved a few pixels. Mouse and pen only — touch keeps
 * scrolling.
 *
 * `geometry` describes the layout in content coordinates (relative to `contentRef`,
 * the element the items are positioned in), so hit-testing never needs the DOM.
 */
export function useMarquee({
  scrollRef,
  contentRef,
  geometry,
  enabled,
  onStart,
  onChange,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  geometry: GridGeometry;
  enabled: boolean;
  onStart: (additive: boolean) => void;
  onChange: (indexes: number[]) => void;
}) {
  const [box, setBox] = useState<Rect | null>(null);
  const geometryRef = useRef(geometry);
  const onStartRef = useRef(onStart);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    geometryRef.current = geometry;
    onStartRef.current = onStart;
    onChangeRef.current = onChange;
  });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const scroller = scrollRef.current;
      const content = contentRef.current;
      if (!enabled || !scroller || !content) return;
      if (e.button !== 0 || e.pointerType === "touch") return;
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return;

      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      const toContent = (cx: number, cy: number) => {
        const r = content.getBoundingClientRect();
        return { x: cx - r.left, y: cy - r.top };
      };
      const anchor = toContent(e.clientX, e.clientY);
      let pointer = { x: e.clientX, y: e.clientY };
      let active = false;
      let raf = 0;

      const update = () => {
        const here = toContent(pointer.x, pointer.y);
        const rect = rectBetween(anchor.x, anchor.y, here.x, here.y);
        setBox(rect);
        onChangeRef.current(itemsInRect(geometryRef.current, rect));
      };

      const tick = () => {
        const r = scroller.getBoundingClientRect();
        const fromTop = pointer.y - r.top;
        const fromBottom = r.bottom - pointer.y;
        const step =
          fromTop < EDGE
            ? -Math.min(MAX_SCROLL_STEP, EDGE - fromTop)
            : fromBottom < EDGE
              ? Math.min(MAX_SCROLL_STEP, EDGE - fromBottom)
              : 0;
        if (step !== 0) {
          scroller.scrollTop += step;
          update();
        }
        raf = requestAnimationFrame(tick);
      };

      const onMove = (ev: PointerEvent) => {
        pointer = { x: ev.clientX, y: ev.clientY };
        if (!active) {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_THRESHOLD) return;
          active = true;
          window.getSelection()?.removeAllRanges();
          onStartRef.current(additive);
          raf = requestAnimationFrame(tick);
        }
        update();
      };

      const end = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        cancelAnimationFrame(raf);
        if (!active) return;
        setBox(null);
        // The release would otherwise count as a click on whatever is under it.
        const swallow = (ev: MouseEvent) => ev.stopPropagation();
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [enabled, scrollRef, contentRef],
  );

  return { box, onPointerDown };
}
