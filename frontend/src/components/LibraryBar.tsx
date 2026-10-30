import * as React from "react";
import type { Library } from "@/types/library";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Searchable library picker (popover + command list). */
function LibraryCombobox({
  libraries,
  libraryId,
  onLibraryChange,
}: {
  libraries: Library[];
  libraryId: number | null;
  onLibraryChange: (id: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = libraries.find((l) => l.id === libraryId);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="Library"
          className="flex h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs hover:bg-accent/40"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name || selected.path : "Select a library"}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-56 p-0">
        <Command>
          <CommandInput placeholder="Search libraries…" />
          <CommandList>
            <CommandEmpty>No library found.</CommandEmpty>
            <CommandGroup>
              {libraries.map((l) => (
                <CommandItem
                  key={l.id}
                  value={`${l.name} ${l.path}`}
                  onSelect={() => {
                    onLibraryChange(l.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("h-3.5 w-3.5", l.id === libraryId ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{l.name || l.path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

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
        <LibraryCombobox
          libraries={libraries}
          libraryId={libraryId}
          onLibraryChange={onLibraryChange}
        />
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
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="shrink-0 cursor-pointer select-none text-sm">
        Keep originals
      </label>
      <span className="text-2xs leading-tight text-muted-foreground/60">{hint}</span>
    </div>
  );
}
