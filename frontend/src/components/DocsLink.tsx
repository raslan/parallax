import { useLocation } from "react-router";
import { BookOpen } from "lucide-react";
import { docsUrlFor } from "@/lib/docsLink";
import { routeLabel } from "@/components/layout/nav-config";

/**
 * Link to the hosted documentation page for the current route, shown next to the page title (see `PageTitle`) so
 * it is clear it is about this page. A plain link that opens in a new tab: the app never fetches the docs, works
 * offline, and sends nothing anywhere until it is clicked. Renders nothing on a route with no docs page.
 */
export function DocsLink() {
  const { pathname } = useLocation();
  const url = docsUrlFor(pathname);
  if (!url) return null;
  const page = routeLabel(pathname)?.split(" · ")[0];
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Documentation${page ? ` for ${page}` : ""} (opens in a new tab)`}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
    >
      <BookOpen className="h-3.5 w-3.5" aria-hidden />
      Documentation
    </a>
  );
}
