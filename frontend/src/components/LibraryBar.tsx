import * as React from "react";
import type { Library } from "@/types/library";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
        <Select
          value={libraryId != null ? String(libraryId) : undefined}
          onValueChange={(v) => onLibraryChange(Number(v))}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select a library" />
          </SelectTrigger>
          <SelectContent>
            {libraries.map((l) => (
              <SelectItem key={l.id} value={String(l.id)}>
                {l.name || l.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
  const id = React.useId();
  return (
    <div className="flex items-center gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <label htmlFor={id} className="shrink-0 cursor-pointer select-none text-sm">
        Keep originals
      </label>
      <span className="text-[11px] leading-tight text-muted-foreground/60">{hint}</span>
    </div>
  );
}
