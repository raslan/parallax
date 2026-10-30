import * as React from "react";

import { cn } from "@/lib/utils";

/** Placeholder block with the app's shimmer sweep (see `animate-shimmer`). */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("relative overflow-hidden rounded-md bg-muted", className)}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-linear-to-r from-transparent via-foreground/10 to-transparent" />
    </div>
  );
}

export { Skeleton };
