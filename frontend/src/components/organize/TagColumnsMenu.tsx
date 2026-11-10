import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TAG_COLUMN_IDS, TAG_LABELS, type TagColumnId } from "@/lib/organizeTags";

/** "Columns" menu of the list view: which tags show as columns after the file name. */
export function TagColumnsMenu({
  selected,
  onChange,
}: {
  selected: TagColumnId[];
  onChange: (cols: TagColumnId[]) => void;
}) {
  const toggle = (id: TagColumnId, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    // Always the menu's own order, whichever was ticked first.
    onChange(TAG_COLUMN_IDS.filter((c) => next.has(c)));
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="mr-1.5 h-3.5 w-3.5" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 space-y-2 p-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Tags</p>
        {TAG_COLUMN_IDS.map((id) => (
          <div key={id} className="flex items-center gap-2">
            <Checkbox
              id={`tag-col-${id}`}
              checked={selected.includes(id)}
              onCheckedChange={(v) => toggle(id, v === true)}
            />
            <Label htmlFor={`tag-col-${id}`} className="cursor-pointer text-sm font-normal">
              {TAG_LABELS[id]}
            </Label>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
