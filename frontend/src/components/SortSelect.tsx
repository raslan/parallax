import { ArrowDown, ArrowUp } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import type { SortDir } from "@/components/FileSelectGrid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The grid-toolbar sort control the file pages use (Files, Images, Cleanup,
 * AudioFiles): a key `Select` plus a direction arrow button, as one component.
 * Pairs with `useSort`: `onSort(key)` is its `toggleSort`, so picking a new key
 * applies that key's default direction and the arrow re-sorts on the current key
 * (which reverses it). Props-in/callbacks-out.
 */
export function SortSelect<K extends string>({
  label,
  options,
  value,
  dir,
  onSort,
}: {
  /** Accessible name of the key picker, e.g. "Sort files". */
  label: string;
  options: readonly { value: K; label: string }[];
  value: K;
  dir: SortDir;
  onSort: (key: K) => void;
}) {
  const dirLabel = `${dir === "asc" ? "Ascending" : "Descending"}, click to reverse`;
  return (
    <div className="flex items-center gap-1">
      <Select
        value={value}
        onValueChange={(v) => {
          if (v !== value) onSort(v as K);
        }}
      >
        <SelectTrigger aria-label={label} className="h-8 w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <IconButton
        label={dirLabel}
        onClick={() => onSort(value)}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {dir === "asc" ? (
          <ArrowUp key="asc" className="h-3.5 w-3.5 animate-pop" />
        ) : (
          <ArrowDown key="desc" className="h-3.5 w-3.5 animate-pop" />
        )}
      </IconButton>
    </div>
  );
}
