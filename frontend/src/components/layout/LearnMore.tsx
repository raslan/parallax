import { useLocation } from "react-router";
import { BookOpen } from "lucide-react";
import { Tip } from "@/components/Tip";
import { docsUrlFor } from "@/lib/docsLink";
import { routeLabel } from "./nav-config";

/**
 * Header link to the hosted documentation page for the current route. A plain link that opens in a new tab: the
 * app never fetches the docs, works offline, and sends nothing anywhere until it is clicked. Renders nothing on
 * a route with no docs page.
 */
export function LearnMore() {
  const { pathname } = useLocation();
  const url = docsUrlFor(pathname);
  if (!url) return null;
  const page = routeLabel(pathname)?.split(" · ")[0];
  const label = page ? `Learn more about ${page}` : "Learn more";
  return (
    <Tip label={label}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${label} (opens the documentation in a new tab)`}
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground"
      >
        <BookOpen className="h-4 w-4" />
        <span className="hidden text-sm xl:inline">Learn more</span>
      </a>
    </Tip>
  );
}
