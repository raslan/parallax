import { useRef, useState, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface VirtualizedGridProps<T> {
  items: T[];
  getKey: (item: T) => string | number;
  renderItem: (item: T) => React.ReactNode;
  itemHeight: number;
  minColumnWidth?: number;
  mode: "grid" | "list";
  gap?: number;
  className?: string;
}

export function VirtualizedGrid<T>({
  items,
  getKey,
  renderItem,
  itemHeight,
  minColumnWidth = 200,
  mode,
  gap = 12,
  className,
}: VirtualizedGridProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    if (mode === "list") {
      setColumnCount(1);
      return;
    }
    const compute = () => {
      const width = el.clientWidth;
      setColumnCount(Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap))));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, minColumnWidth, gap]);

  const rowCount = Math.ceil(items.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight + gap,
    overscan: 4,
  });

  return (
    <div ref={parentRef} className={className} style={{ overflow: "auto", height: "100%" }}>
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
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                gap,
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
