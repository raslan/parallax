import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Themed tooltip around a single element (usually an icon-only button). Unlike
 * the native `title` attribute it also appears on keyboard focus. Wrap the
 * element directly: `<Tip label="Refresh"><button …/></Tip>`.
 */
export function Tip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
