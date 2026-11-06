import docsRoutes from "./docsRoutes.json";

/** Where the hosted documentation lives. The app only links to it; it never fetches anything from there. */
export const DOCS_HOST = docsRoutes.host;

const ROUTES: Record<string, string> = docsRoutes.routes;

/**
 * The hosted docs page for an app route, or `null` when the route has none (so no link is shown).
 * `docsRoutes.json` is shared with the docs site's coverage check (`site/scripts/check-coverage.mjs`), which
 * fails when a page in the nav has no entry here.
 */
export function docsUrlFor(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const page = ROUTES[path];
  return page ? `${DOCS_HOST}/docs/${page}` : null;
}
