import { LayoutGrid, List, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** Filename search box used in the file-page toolbars. */
export function ToolbarSearch({
  value,
  onChange,
  placeholder = "Search files…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-48 rounded-md border border-input bg-transparent pl-7 pr-3 text-sm focus:outline-hidden focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

export type ViewMode = "grid" | "list";

/** Grid/list switch, identical across every file page. */
export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const item = (mode: ViewMode, label: string, Icon: typeof List) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      aria-label={label}
      aria-pressed={value === mode}
      title={label}
      data-testid={`view-${mode}`}
      className={cn(
        "flex h-8 w-8 items-center justify-center transition-colors",
        value === mode
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
  return (
    <div className="flex overflow-hidden rounded-md border border-border">
      {item("grid", "Grid view", LayoutGrid)}
      {item("list", "List view", List)}
    </div>
  );
}
