import type { Library } from "@/types/library";
import { cn } from "@/lib/utils";

/**
 * Horizontal strip above a page's controls. Library picker on the left; an
 * optional `right` node (e.g. `<KeepOriginalsToggle>`) fills a second 50/50
 * cell with a hairline divider between. With no `right`, it's a single
 * full-width cell. Used by Compress, Toolbox, Cleanup, Duplicates.
 */
export function LibraryBar({
  libraries,
  libraryId,
  onLibraryChange,
  right,
}: {
  libraries: Library[];
  libraryId: number | null;
  onLibraryChange: (id: number) => void;
  right?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border",
        right && "sm:grid-cols-2",
      )}
    >
      <div className="flex items-center gap-3 bg-card px-4 py-3">
        <span className="shrink-0 text-sm text-muted-foreground">Library</span>
        <select
          value={libraryId ?? ""}
          onChange={(e) => onLibraryChange(Number(e.target.value))}
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name || l.path}
            </option>
          ))}
        </select>
      </div>
      {right && <div className="flex items-center gap-3 bg-card px-4 py-3">{right}</div>}
    </div>
  );
}

export function KeepOriginalsToggle({
  checked,
  onChange,
  hint = "Move the source file to _originals/ before replacing it",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-primary"
      />
      <span className="shrink-0 text-sm">Keep originals</span>
      <span className="text-[11px] leading-tight text-muted-foreground/60">{hint}</span>
    </label>
  );
}
