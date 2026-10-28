import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * A collapsible group inside a long options form — keeps the everyday controls
 * in view and tucks the rarely-touched ones ("Advanced") behind a header.
 * Content stays mounted while closed, so react-hook-form fields keep their values.
 */
export function OptionSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border/30 pt-3">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground">
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent forceMount className={cn("space-y-4 pt-3", !open && "hidden")}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
