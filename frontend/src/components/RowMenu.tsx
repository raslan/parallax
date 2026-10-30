import { Fragment, type ReactNode } from "react";
import { Copy, MoreHorizontal, Play, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** One entry in a file row/card menu. `separatorBefore` groups destructive actions apart. */
export interface RowAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
}

/** Play + Copy path (when a path is known), then any page-specific actions. */
export function buildRowActions({
  onPlay,
  path,
  extra = [],
}: {
  onPlay?: () => void;
  path?: string;
  extra?: RowAction[];
}): RowAction[] {
  const actions: RowAction[] = [];
  if (onPlay) actions.push({ label: "Play", icon: Play, onSelect: onPlay });
  if (path) {
    actions.push({
      label: "Copy path",
      icon: Copy,
      onSelect: () => {
        navigator.clipboard
          .writeText(path)
          .then(() => toast.success("Path copied"))
          .catch(() => toast.error("Couldn't copy the path"));
      },
    });
  }
  return [...actions, ...extra];
}

// Menu content is portaled but React still bubbles its clicks to the row that
// rendered it, which would toggle the row's selection — stop that here.
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

const itemClass = (a: RowAction) => cn(a.destructive && "text-destructive focus:text-destructive");

/** Right-click menu for a row/card. Wraps the element as-is (no extra DOM). */
export function RowContextMenu({
  actions,
  children,
}: {
  actions: RowAction[];
  children: ReactNode;
}) {
  if (actions.length === 0) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent onClick={stop}>
        {actions.map((a) => (
          <Fragment key={a.label}>
            {a.separatorBefore && <ContextMenuSeparator />}
            <ContextMenuItem className={itemClass(a)} onSelect={a.onSelect}>
              <a.icon />
              {a.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The ⋯ button version of the same actions, for touch and discoverability. */
export function RowMoreMenu({ actions, className }: { actions: RowAction[]; className?: string }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More actions"
          onClick={stop}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={stop}>
        {actions.map((a) => (
          <Fragment key={a.label}>
            {a.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem className={itemClass(a)} onSelect={a.onSelect}>
              <a.icon />
              {a.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
