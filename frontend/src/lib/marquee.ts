export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface GridGeometry {
  count: number;
  columns: number;
  colWidth: number;
  colGap: number;
  rowHeight: number;
  rowGap: number;
}

/** Normalised rect spanning two points, in any drag direction. */
export function rectBetween(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    right: Math.max(ax, bx),
    bottom: Math.max(ay, by),
  };
}

function span(lo: number, hi: number, size: number, gap: number, max: number): [number, number] {
  const step = size + gap;
  const first = Math.max(0, Math.ceil((lo - size) / step));
  const last = Math.min(max, Math.floor(hi / step));
  return [first, last];
}

/**
 * Indexes of the items a drag rect touches, worked out from the layout alone —
 * virtualised rows aren't in the DOM, so the DOM can't be asked. Touching an
 * item's edge counts; the gaps between items don't.
 */
export function itemsInRect(g: GridGeometry, r: Rect): number[] {
  if (g.count <= 0 || g.columns <= 0 || g.colWidth <= 0 || g.rowHeight <= 0) return [];
  const rows = Math.ceil(g.count / g.columns);
  const [r0, r1] = span(r.top, r.bottom, g.rowHeight, g.rowGap, rows - 1);
  const [c0, c1] = span(r.left, r.right, g.colWidth, g.colGap, g.columns - 1);
  const out: number[] = [];
  for (let row = r0; row <= r1; row++) {
    const y = row * (g.rowHeight + g.rowGap);
    if (r.bottom < y || r.top > y + g.rowHeight) continue;
    for (let col = c0; col <= c1; col++) {
      const x = col * (g.colWidth + g.colGap);
      if (r.right < x || r.left > x + g.colWidth) continue;
      const index = row * g.columns + col;
      if (index < g.count) out.push(index);
    }
  }
  return out;
}
