import { Skeleton } from "@/components/ui/skeleton";

function Loading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

/** Ghost cards at the real card proportions (4:3 thumbnail + two text lines). */
export function GridSkeleton({
  count = 12,
  minColumnWidth = 200,
}: {
  count?: number;
  minColumnWidth?: number;
}) {
  return (
    <Loading>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))` }}
      >
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border">
            <Skeleton className="aspect-[4/3] rounded-none" />
            <div className="space-y-1.5 border-t border-border bg-px-elevated p-2.5">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** Ghost rows shaped like the file list rows (thumbnail well, two lines, trailing cells). */
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Loading>
      <div className="overflow-hidden rounded-lg border border-border">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0"
          >
            <Skeleton className="h-8 w-14 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="hidden h-3 w-16 sm:block" />
            <Skeleton className="hidden h-3 w-16 md:block" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** Whole-page fallback (route chunk loading): heading block + list. */
export function PageSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <ListSkeleton />
    </div>
  );
}
