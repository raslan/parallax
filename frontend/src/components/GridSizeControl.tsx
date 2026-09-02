import { LayoutGrid } from "lucide-react";

/**
 * Compact slider for a virtualized grid's card size — icon-slider-icon, no
 * numeric readout, so it sits inline with a view-mode toggle without eating
 * much width. `title` carries the exact px value for anyone who wants it.
 */
export function GridSizeControl({
  value,
  onChange,
  min = 120,
  max = 360,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-1.5" title={`Card size: ${value}px`}>
      <LayoutGrid className="h-3 w-3 shrink-0 text-muted-foreground" />
      <input
        type="range"
        min={min}
        max={max}
        step={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-20 accent-primary"
      />
      <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
