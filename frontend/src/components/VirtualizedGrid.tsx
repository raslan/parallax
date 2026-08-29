import { useRef, useState, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface VirtualizedGridProps<T> {
  items: T[];
  getKey: (item: T) => string | number;
  renderItem: (item: T) => React.ReactNode;
  /**
   * Fixed row height in px. Always used in `mode: "list"` (rows there are a fixed
   * height by construction) and used in `mode: "grid"` only as the fallback when
   * `itemAspectRatio` is not supplied.
   */
  itemHeight: number;
  /**
   * Grid mode only. Width/height ratio of the card's aspect-ratio-constrained media
   * area (e.g. `1` for `aspect-square`, `16 / 9` for `aspect-video`). When given, the
   * row height is derived from the ACTUAL computed column width —
   * `columnWidth / itemAspectRatio + itemChromeHeight` — instead of the flat
   * `itemHeight`, so cards never outgrow their virtualized row and overlap.
   */
  itemAspectRatio?: number;
  /**
   * Grid mode only, paired with `itemAspectRatio`. Fixed px height of everything the
   * card renders outside the aspect-ratio media area (text block, padding, borders).
   * Defaults to 0.
   */
  itemChromeHeight?: number;
  /**
   * Opt in to real per-row measurement for rows whose height genuinely varies at
   * runtime and cannot be derived (e.g. a card that grows a progress bar or an
   * expandable error block). Costs a ResizeObserver per mounted row — leave off for
   * fixed-height rows and for grid rows sized via `itemAspectRatio`.
   */
  dynamicHeight?: boolean;
  minColumnWidth?: number;
  mode: "grid" | "list";
  gap?: number;
  /**
   * When set, the scroll container sizes to its content and is capped at this CSS
   * length (e.g. `"70vh"`), so a handful of items doesn't leave a large blank area.
   * When omitted, the container fills its parent's height.
   */
  maxHeight?: string;
  className?: string;
}

export function VirtualizedGrid<T>({
  items,
  getKey,
  renderItem,
  itemHeight,
  itemAspectRatio,
  itemChromeHeight = 0,
  dynamicHeight = false,
  minColumnWidth = 200,
  mode,
  gap = 12,
  maxHeight,
  className,
}: VirtualizedGridProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);
  const [columnWidth, setColumnWidth] = useState(0);

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    if (mode === "list") {
      setColumnCount(1);
      return;
    }
    const compute = () => {
      const width = el.clientWidth;
      const cols = Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
      setColumnCount(cols);
      setColumnWidth(Math.max(0, (width - gap * (cols - 1)) / cols));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, minColumnWidth, gap]);

  // In list mode there's a single column, so `gap` is not spacing between anything —
  // adding it to the row height would append a dead band under every row.
  const rowGap = mode === "list" ? 0 : gap;

  // Grid rows derive their height from the real column width whenever the caller told
  // us the card's aspect ratio; otherwise fall back to the flat itemHeight.
  const rowHeight =
    mode === "grid" && itemAspectRatio && columnWidth > 0
      ? columnWidth / itemAspectRatio + itemChromeHeight
      : itemHeight;

  const rowCount = Math.ceil(items.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
    gap: rowGap,
  });

  // `estimateSize` isn't itself a measurement-cache dependency inside the virtualizer,
  // so a `rowHeight` change (e.g. the same column count at a different column width)
  // wouldn't otherwise invalidate already-cached row measurements. Force a re-measure
  // whenever the derived height changes.
  useLayoutEffect(() => {
    rowVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight]);

  return (
    <div
      ref={parentRef}
      className={className}
      style={maxHeight ? { overflow: "auto", maxHeight } : { overflow: "auto", height: "100%" }}
    >
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const start = virtualRow.index * columnCount;
          const rowItems = items.slice(start, start + columnCount);
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={dynamicHeight ? rowVirtualizer.measureElement : undefined}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                // With dynamic measurement the row must be free to size to its content,
                // otherwise we'd just be measuring the estimate back again.
                ...(dynamicHeight ? {} : { height: rowHeight }),
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                gap: rowGap,
              }}
            >
              {rowItems.map((item) => (
                <div key={getKey(item)}>{renderItem(item)}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
