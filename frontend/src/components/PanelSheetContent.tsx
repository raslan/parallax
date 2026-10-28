import * as React from "react";
import { SheetContent } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

/**
 * Body for the non-modal settings panels (Compress, Splice, YouTube options).
 * From `md` up it's the usual right-hand panel; on phones it becomes a bottom
 * sheet capped at 60% of the screen, so the list above it stays visible and
 * tappable instead of being covered edge to edge.
 */
export const PanelSheetContent = React.forwardRef<
  React.ElementRef<typeof SheetContent>,
  Omit<React.ComponentPropsWithoutRef<typeof SheetContent>, "side">
>(({ className, ...props }, ref) => {
  const mobile = useMediaQuery("(max-width: 767px)");
  return (
    <SheetContent
      ref={ref}
      side={mobile ? "bottom" : "right"}
      className={cn(
        className,
        mobile && "w-full max-h-[60dvh] max-w-none overflow-y-auto rounded-t-xl",
      )}
      {...props}
    />
  );
});
PanelSheetContent.displayName = "PanelSheetContent";
