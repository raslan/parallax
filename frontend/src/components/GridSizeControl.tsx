import { LayoutGrid } from "lucide-react";
import { Slider } from "@/components/ui/slider";

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
      <Slider
        min={min}
        max={max}
        step={10}
        value={[value]}
        onValueChange={([v]) => onChange(v ?? value)}
        className="w-20"
      />
      <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
