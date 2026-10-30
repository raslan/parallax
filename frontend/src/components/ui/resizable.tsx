import { Group, Panel, Separator } from "react-resizable-panels";
import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = Group;
const ResizablePanel = Panel;

/** Draggable divider between two panels; the grip shows on hover/focus. */
function ResizableHandle({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        "group relative flex w-3 shrink-0 items-center justify-center outline-hidden",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:transition-colors",
        "hover:after:bg-primary/60 focus-visible:after:bg-primary data-[separator=active]:after:bg-primary",
        className,
      )}
      {...props}
    >
      <GripVertical className="relative z-10 h-4 w-4 rounded-sm bg-card text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
