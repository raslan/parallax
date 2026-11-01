import { useDeferredValue, useMemo, useState } from "react";
import { ChevronRight, Search, Sparkles } from "lucide-react";
import { Tip } from "@/components/Tip";
import { detectNameGroups, filterGroups, type NameGroup } from "@/lib/nameGroups";
import { cn } from "@/lib/utils";

const INITIAL_ROOTS = 16;

function Chip({
  group,
  onPick,
  nested,
}: {
  group: NameGroup;
  onPick: (text: string) => void;
  nested?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasKids = group.children.length > 0;
  return (
    <li className={cn("flex flex-col items-start", nested && "animate-fade-in")}>
      <div className="inline-flex max-w-full items-stretch overflow-hidden rounded-md border bg-px-surface text-xs transition-colors duration-100 hover:border-primary/50">
        <Tip label={`Add a filter: name contains "${group.text}"`}>
          <button
            type="button"
            onClick={() => onPick(group.text)}
            className="flex min-w-0 items-center gap-1.5 px-2 py-1 transition-colors duration-100 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-hidden"
          >
            <span className="truncate">{group.text}</span>
            <span className="text-muted-foreground">·</span>
            <span className="tabular-nums text-muted-foreground">
              {group.count.toLocaleString()}
            </span>
          </button>
        </Tip>
        {hasKids && (
          <Tip label={open ? "Hide narrower groups" : `Show ${group.children.length} narrower`}>
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${group.text}`}
              onClick={() => setOpen((o) => !o)}
              className="flex items-center border-l px-1 text-muted-foreground transition-colors duration-100 hover:bg-accent/50 hover:text-foreground focus-visible:outline-hidden"
            >
              <ChevronRight
                className={cn(
                  "h-3 w-3 transition-transform duration-200 motion-reduce:transition-none",
                  open && "rotate-90",
                )}
              />
            </button>
          </Tip>
        )}
      </div>
      {hasKids && (
        <div
          className={cn(
            "grid w-full transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <ul
              inert={!open}
              className="ml-3 mt-1.5 flex flex-wrap gap-1.5 border-l border-primary/30 pl-2.5"
            >
              {group.children.map((c) => (
                <Chip key={c.text} group={c} onPick={onPick} nested />
              ))}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Repeated name fragments in the open folder (`text · count`), each a one-click
 * `name contains` filter. Expanding a chip reveals narrower groups; typing
 * narrows the chips. Detection is O(names x length), so it runs on a deferred
 * copy of `names` (pass a referentially stable array) and only recomputes when
 * the folder's file list changes, never per render or keystroke.
 */
export function NameGroupChips({
  names,
  onPick,
}: {
  names: string[];
  onPick: (text: string) => void;
}) {
  const deferredNames = useDeferredValue(names);
  const groups = useMemo(() => detectNameGroups(deferredNames), [deferredNames]);
  const [typed, setTyped] = useState("");
  const deferredTyped = useDeferredValue(typed);
  const shown = useMemo(() => filterGroups(groups, deferredTyped), [groups, deferredTyped]);
  const [all, setAll] = useState(false);

  if (groups.length === 0) return null;
  const visible = all ? shown : shown.slice(0, INITIAL_ROOTS);

  return (
    <div className="space-y-2 animate-fade-in">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Common names
        </span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Narrow groups…"
            aria-label="Narrow name groups"
            className="h-7 w-44 rounded-md border bg-transparent pl-7 pr-2 text-xs outline-hidden transition-colors duration-100 placeholder:text-muted-foreground/70 focus-visible:border-primary/60"
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">No group contains &ldquo;{typed}&rdquo;.</p>
      ) : (
        <ul className="flex flex-wrap items-start gap-1.5">
          {visible.map((g) => (
            <Chip key={g.text} group={g} onPick={onPick} />
          ))}
          {shown.length > INITIAL_ROOTS && (
            <li>
              <button
                type="button"
                onClick={() => setAll((a) => !a)}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground"
              >
                {all ? "Show fewer" : `Show ${shown.length - INITIAL_ROOTS} more`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
